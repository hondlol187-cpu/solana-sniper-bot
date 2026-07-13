import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readFile,
  unlink,
} from 'node:fs/promises';

function configureEnvironment(): string {
  const suffix =
    `${process.pid}-${Date.now()}`;

  process.env.LIVE_TRADING =
    'false';

  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';

  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';

  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';

  process.env.AUDIT_FILE =
    `/tmp/sniper-lock-audit-${suffix}.jsonl`;

  process.env.FILE_LOCK_TIMEOUT_MS =
    '2000';

  process.env.FILE_LOCK_RETRY_MS =
    '10';

  process.env.FILE_LOCK_STALE_SECONDS =
    '10';

  return `/tmp/sniper-lock-target-${suffix}`;
}

const sleep = (
  milliseconds: number
) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, milliseconds)
  );

async function remove(
  path: string
): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    const code = (
      error as NodeJS.ErrnoException
    ).code;

    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

test(
  'serializes concurrent operations',
  async () => {
    const target =
      configureEnvironment();

    const fileLock =
      await import(
        '../sniper/file-lock.js'
      );

    const events: string[] = [];

    try {
      const first =
        fileLock.withFileLock(
          target,
          async () => {
            events.push(
              'first-start'
            );

            await sleep(100);

            events.push(
              'first-end'
            );
          }
        );

      /*
       * Give the first operation time to obtain the
       * lock before starting the second.
       */
      await sleep(10);

      const second =
        fileLock.withFileLock(
          target,
          async () => {
            events.push(
              'second-start'
            );

            events.push(
              'second-end'
            );
          }
        );

      await Promise.all([
        first,
        second,
      ]);

      assert.deepEqual(
        events,
        [
          'first-start',
          'first-end',
          'second-start',
          'second-end',
        ]
      );
    } finally {
      await remove(target);
      await remove(
        `${target}.lock`
      );

      if (
        process.env.AUDIT_FILE
      ) {
        await remove(
          process.env.AUDIT_FILE
        );
      }
    }
  }
);

test(
  'releases lock when operation throws',
  async () => {
    const target =
      configureEnvironment();

    const fileLock =
      await import(
        '../sniper/file-lock.js'
      );

    try {
      await assert.rejects(
        () =>
          fileLock.withFileLock(
            target,
            async () => {
              throw new Error(
                'expected failure'
              );
            }
          ),
        /expected failure/
      );

      let acquired = false;

      await fileLock.withFileLock(
        target,
        async () => {
          acquired = true;
        }
      );

      assert.equal(
        acquired,
        true
      );

      await assert.rejects(
        () =>
          readFile(
            `${target}.lock`,
            'utf8'
          ),
        (error: unknown) =>
          (
            error as NodeJS.ErrnoException
          ).code === 'ENOENT'
      );
    } finally {
      await remove(target);
      await remove(
        `${target}.lock`
      );

      if (
        process.env.AUDIT_FILE
      ) {
        await remove(
          process.env.AUDIT_FILE
        );
      }
    }
  }
);
