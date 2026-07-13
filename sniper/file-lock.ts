import { randomUUID } from 'node:crypto';

import {
  open,
  readFile,
  unlink,
} from 'node:fs/promises';

import { config } from './config.js';
import { audit } from './audit.js';

interface LockData {
  pid: number;
  token: string;
  createdAt: string;
  target: string;
}

function sleep(
  milliseconds: number
): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(
      resolve,
      milliseconds
    )
  );
}

function isErrnoException(
  error: unknown
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error
  );
}

function processExists(
  pid: number
): boolean {
  if (
    !Number.isInteger(pid) ||
    pid <= 0
  ) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      isErrnoException(error) &&
      error.code === 'EPERM'
    ) {
      return true;
    }

    return false;
  }
}

async function readLock(
  lockPath: string
): Promise<LockData | null> {
  try {
    const content = await readFile(
      lockPath,
      'utf8'
    );

    const parsed = JSON.parse(
      content
    ) as Partial<LockData>;

    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.token !==
        'string' ||
      typeof parsed.createdAt !==
        'string' ||
      typeof parsed.target !==
        'string'
    ) {
      return null;
    }

    return parsed as LockData;
  } catch {
    return null;
  }
}

function ageSeconds(
  lock: LockData
): number {
  return (
    Date.now() -
    new Date(
      lock.createdAt
    ).getTime()
  ) / 1_000;
}

async function removeLockIfOwned(
  lockPath: string,
  token: string
): Promise<void> {
  const current =
    await readLock(lockPath);

  if (
    !current ||
    current.token !== token
  ) {
    return;
  }

  try {
    await unlink(lockPath);
  } catch (error) {
    if (
      !isErrnoException(error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}

async function removeStaleLock(
  lockPath: string,
  observed: LockData | null
): Promise<boolean> {
  if (!observed) {
    /*
     * A malformed lock is removed only after the
     * stale timeout has passed based on its file
     * contents being unreadable. To avoid deleting
     * a lock while it is being written, wait and
     * retry instead.
     */
    return false;
  }

  const stale =
    ageSeconds(observed) >
      config.fileLockStaleSeconds &&
    !processExists(observed.pid);

  if (!stale) {
    return false;
  }

  /*
   * Re-read before deletion so a replacement lock
   * is not removed accidentally.
   */
  const current =
    await readLock(lockPath);

  if (
    !current ||
    current.token !== observed.token
  ) {
    return false;
  }

  try {
    await unlink(lockPath);

    await audit(
      'file-lock.stale.removed',
      {
        lockPath,
        target:
          observed.target,
        previousPid:
          observed.pid,
        ageSeconds:
          ageSeconds(observed),
      }
    );

    return true;
  } catch (error) {
    if (
      isErrnoException(error) &&
      error.code === 'ENOENT'
    ) {
      return true;
    }

    throw error;
  }
}

export async function acquireFileLock(
  targetPath: string
): Promise<() => Promise<void>> {
  const lockPath =
    `${targetPath}.lock`;

  const token = randomUUID();

  const startedAt =
    Date.now();

  while (
    Date.now() - startedAt <
    config.fileLockTimeoutMs
  ) {
    const lock: LockData = {
      pid: process.pid,
      token,
      createdAt:
        new Date().toISOString(),
      target: targetPath,
    };

    try {
      const handle = await open(
        lockPath,
        'wx',
        0o600
      );

      try {
        await handle.writeFile(
          JSON.stringify(
            lock,
            null,
            2
          ),
          'utf8'
        );
      } finally {
        await handle.close();
      }

      let released = false;

      return async () => {
        if (released) return;
        released = true;

        await removeLockIfOwned(
          lockPath,
          token
        );
      };
    } catch (error) {
      if (
        !isErrnoException(error) ||
        error.code !== 'EEXIST'
      ) {
        throw error;
      }

      const existing =
        await readLock(lockPath);

      const removed =
        await removeStaleLock(
          lockPath,
          existing
        );

      if (removed) {
        continue;
      }

      await sleep(
        config.fileLockRetryMs
      );
    }
  }

  const existing =
    await readLock(lockPath);

  throw new Error(
    [
      `Timed out acquiring lock for ${targetPath}.`,
      existing
        ? `Held by PID ${existing.pid} since ${existing.createdAt}.`
        : 'Lock contents could not be read.',
    ].join(' ')
  );
}

export async function withFileLock<T>(
  targetPath: string,
  operation: () => Promise<T>
): Promise<T> {
  const release =
    await acquireFileLock(
      targetPath
    );

  try {
    return await operation();
  } finally {
    await release();
  }
}
