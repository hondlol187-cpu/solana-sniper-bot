import {
  open,
  readFile,
  unlink,
} from 'node:fs/promises';

import { randomUUID } from 'node:crypto';

import { config } from './config.js';

interface LockData {
  pid: number;
  token: string;
  createdAt: string;
}

function isErrnoException(
  error: unknown
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error
  );
}

function processExists(pid: number): boolean {
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

async function readLock(): Promise<
  LockData | null
> {
  try {
    const content = await readFile(
      config.lockFile,
      'utf8'
    );

    const parsed = JSON.parse(
      content
    ) as Partial<LockData>;

    if (
      typeof parsed.pid !== 'number' ||
      typeof parsed.token !== 'string' ||
      typeof parsed.createdAt !== 'string'
    ) {
      return null;
    }

    return parsed as LockData;
  } catch {
    return null;
  }
}

async function removeLock(): Promise<void> {
  try {
    await unlink(config.lockFile);
  } catch (error) {
    if (
      !isErrnoException(error) ||
      error.code !== 'ENOENT'
    ) {
      throw error;
    }
  }
}

export async function acquireProcessLock(): Promise<
  () => Promise<void>
> {
  const token = randomUUID();

  const lockData: LockData = {
    pid: process.pid,
    token,
    createdAt: new Date().toISOString(),
  };

  for (
    let attempt = 0;
    attempt < 2;
    attempt += 1
  ) {
    try {
      const handle = await open(
        config.lockFile,
        'wx',
        0o600
      );

      await handle.writeFile(
        JSON.stringify(lockData, null, 2),
        'utf8'
      );

      await handle.close();

      let released = false;

      return async () => {
        if (released) return;
        released = true;

        const currentLock =
          await readLock();

        /*
         * Do not delete a lock created by a newer
         * process.
         */
        if (
          currentLock?.token === token
        ) {
          await removeLock();
        }
      };
    } catch (error) {
      if (
        !isErrnoException(error) ||
        error.code !== 'EEXIST'
      ) {
        throw error;
      }

      const existingLock =
        await readLock();

      if (
        existingLock &&
        processExists(existingLock.pid)
      ) {
        throw new Error(
          `Another bot process is running with PID ${existingLock.pid}`
        );
      }

      console.warn(
        'Removing stale bot process lock'
      );

      await removeLock();
    }
  }

  throw new Error(
    'Could not acquire bot process lock'
  );
}
