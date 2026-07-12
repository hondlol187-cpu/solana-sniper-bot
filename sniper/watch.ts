import { config } from './config.js';
import { RpcPool } from './rpc.js';

import {
  startRaydiumSignalMonitor,
} from './monitor.js';

import {
  processRaydiumSignal,
} from './pool-pipeline.js';

import {
  hasCandidate,
  queueValidatedPool,
} from './candidate-store.js';

import { audit } from './audit.js';

async function main(): Promise<void> {
  const rpcPool = new RpcPool();

  await rpcPool.initialize();

  const running =
    new Set<Promise<void>>();

  const stop =
    startRaydiumSignalMonitor(
      rpcPool.current(),
      async (signal) => {
        if (
          running.size >=
          config
            .maximumConcurrentPoolValidations
        ) {
          await audit(
            'pool.signal.dropped',
            {
              signature:
                signal.signature,
              reason:
                'validation concurrency limit',
            }
          );

          return;
        }

        const task = (async () => {
          if (
            await hasCandidate(
              signal.signature
            )
          ) {
            await audit(
              'pool.signal.duplicate',
              {
                signature:
                  signal.signature,
              }
            );

            return;
          }

          const pool =
            await processRaydiumSignal(
              rpcPool.current(),
              signal
            );

          if (!pool) return;

          const record =
            await queueValidatedPool(pool);

          console.log(
            [
              'VALIDATED POOL QUEUED',
              `Status: ${record.status}`,
              `Signature: ${record.signature}`,
              `Mint: ${record.baseMint}`,
              `Pool: ${record.poolAddress}`,
              `Liquidity: ${record.pool.liquiditySol} SOL`,
            ].join(' | ')
          );

          /*
           * Intentionally no buy call here.
           * Observe validated candidates before
           * enabling any automatic execution.
           */
        })();

        running.add(task);

        void task.finally(() => {
          running.delete(task);
        });
      }
    );

  await audit(
    'pool.watcher.started',
    {
      rpc:
        rpcPool.currentLabel(),
      automaticTrading: false,
    }
  );

  const shutdown = async (
    signal: string
  ) => {
    console.log(
      `Received ${signal}; stopping watcher`
    );

    stop();

    await Promise.allSettled(
      [...running]
    );

    await audit(
      'pool.watcher.stopped',
      {
        signal,
      }
    );

    process.exit(0);
  };

  process.once(
    'SIGINT',
    () => {
      void shutdown('SIGINT');
    }
  );

  process.once(
    'SIGTERM',
    () => {
      void shutdown('SIGTERM');
    }
  );

  await new Promise<void>(
    () => undefined
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `Watcher failed: ${message}`
  );

  process.exitCode = 1;
});
