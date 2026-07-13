import { config } from './config.js';
import { RpcPool } from './rpc.js';

import {
  getRiskState,
  releaseReservation,
  resetRiskState,
} from './risk.js';

async function walletBalance(
  rpcPool: RpcPool
): Promise<bigint> {
  const balance =
    await rpcPool.call(
      (connection) =>
        connection.getBalance(
          config.walletPublicKey,
          'confirmed'
        )
    );

  return BigInt(balance);
}

async function main(): Promise<void> {
  const [
    command = 'status',
    first,
    second,
  ] = process.argv.slice(2);

  const rpcPool = new RpcPool();
  await rpcPool.initialize();

  const balance =
    await walletBalance(rpcPool);

  if (command === 'status') {
    const state =
      await getRiskState(balance);

    console.log(
      JSON.stringify(
        state,
        null,
        2
      )
    );

    return;
  }

  if (command === 'release') {
    if (!first || !second) {
      throw new Error(
        'Usage: risk release <reservation-id> <exact-mint>'
      );
    }

    await releaseReservation(
      first,
      second,
      balance
    );

    console.log(
      'Risk reservation released'
    );

    return;
  }

  if (command === 'reset') {
    if (
      first !==
      'RESET-RISK-LEDGER'
    ) {
      throw new Error(
        'Reset requires exact phrase RESET-RISK-LEDGER'
      );
    }

    await resetRiskState(balance);

    console.log(
      'Risk ledger reset'
    );

    return;
  }

  throw new Error(
    `Unknown risk command: ${command}`
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
