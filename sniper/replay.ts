import {
  RAYDIUM_AMM_V4,
  RaydiumPoolSignal,
} from './monitor.js';

import { config } from './config.js';
import { RpcPool } from './rpc.js';

import {
  processRaydiumSignal,
} from './pool-pipeline.js';

import {
  queueValidatedPool,
} from './candidate-store.js';

import { audit } from './audit.js';

async function main(): Promise<void> {
  const signature =
    process.argv[2];

  if (!signature) {
    throw new Error(
      'Usage: npm run sniper:replay -- <transaction-signature>'
    );
  }

  const rpcPool = new RpcPool();
  await rpcPool.initialize();

  const transaction =
    await rpcPool.call(
      (connection) =>
        connection.getParsedTransaction(
          signature,
          {
            commitment:
              config
                .requireFinalizedPoolTransaction
                ? 'finalized'
                : 'confirmed',

            maxSupportedTransactionVersion:
              0,
          }
        )
    );

  if (!transaction) {
    throw new Error(
      'Transaction was not found'
    );
  }

  const signal: RaydiumPoolSignal = {
    signature,
    slot: transaction.slot,
    programId:
      RAYDIUM_AMM_V4.toBase58(),
    detectedAt:
      new Date().toISOString(),
    validated: false,
  };

  await audit(
    'pool.replay.started',
    {
      signature,
      slot:
        transaction.slot,
    }
  );

  const pool =
    await processRaydiumSignal(
      rpcPool.current(),
      signal
    );

  if (!pool) {
    throw new Error(
      'Replay transaction was rejected'
    );
  }

  const record =
    await queueValidatedPool(pool);

  console.log(
    [
      'REPLAY PASSED',
      `Signature: ${record.signature}`,
      `Mint: ${record.baseMint}`,
      `Pool: ${record.poolAddress}`,
      `Liquidity: ${record.pool.liquiditySol} SOL`,
      `Status: ${record.status}`,
    ].join(' | ')
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : String(error)
  );

  process.exitCode = 1;
});
