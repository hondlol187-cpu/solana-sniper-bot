import { config } from './config.js';
import { RpcPool } from './rpc.js';

import {
  startRaydiumSignalMonitor,
} from './monitor.js';

import {
  processRaydiumSignal,
} from './pool-pipeline.js';

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
          const pool =
            await processRaydiumSignal(
              rpcPool.current(),
              signal
            );

          if (!pool) return;

          console.log(
            [
              'VALIDATED POOL',
              `Mint: ${pool.baseMint}`,
              `Pool: ${pool.poolAddress}`,
              `Liquidity: ${pool.liquiditySol} SOL`,
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
