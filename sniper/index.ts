import {
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js';

import { config } from './config.js';

import {
  buildSwapTransaction,
  checkRoundTrip,
  getQuote,
  simulateAndSend,
  SOL_MINT,
} from './jupiter.js';

import {
  getBalanceWithFailover,
  monitorAndExit,
  waitForBalanceIncrease,
} from './position.js';

import {
  BotState,
  OpenPositionState,
  PendingBuyState,
  clearState,
  loadState,
  saveState,
} from './state.js';

import { RpcPool } from './rpc.js';
import { checkMintSafety } from './safety.js';

async function recoverPendingBuy(
  rpcPool: RpcPool,
  pending: PendingBuyState
): Promise<OpenPositionState> {
  const mint = new PublicKey(
    pending.mint
  );

  const currentBalance =
    await getBalanceWithFailover(
      rpcPool,
      config.walletPublicKey,
      mint
    );

  const balanceBefore = BigInt(
    pending.balanceBeforeRaw
  );

  if (currentBalance <= balanceBefore) {
    throw new Error(
      [
        'A pending purchase exists but no token balance increase was found.',
        'Do not automatically purchase again.',
        `Inspect ${config.stateFile} and the wallet transaction history.`,
        'Delete the state file only after confirming that the purchase did not execute.',
      ].join(' ')
    );
  }

  const recovered: OpenPositionState = {
    version: 1,
    status: 'open',
    mint: pending.mint,
    purchasedAmountRaw: (
      currentBalance - balanceBefore
    ).toString(),
    entryLamports:
      pending.entryLamports,
    buySignature:
      'RECOVERED_AFTER_RESTART',
    createdAt: pending.createdAt,
  };

  await saveState(recovered);

  return recovered;
}

async function recoverExistingState(
  rpcPool: RpcPool,
  state: BotState
): Promise<void> {
  console.warn(
    `Recovering saved state: ${state.status}`
  );

  const position =
    state.status === 'pending-buy'
      ? await recoverPendingBuy(
          rpcPool,
          state
        )
      : state;

  const exitSignature =
    await monitorAndExit(
      rpcPool,
      position
    );

  console.log(
    `Recovered position exit: ${exitSignature}`
  );
}

async function main(): Promise<void> {
  const rpcPool = new RpcPool();

  /*
   * Recovery always happens before allowing
   * another purchase.
   */
  const existingState =
    await loadState();

  if (existingState) {
    await recoverExistingState(
      rpcPool,
      existingState
    );

    return;
  }

  const outputMint = new PublicKey(
    config.outputMint
  );

  const safety = await rpcPool.call(
    (connection) =>
      checkMintSafety(
        connection,
        outputMint.toBase58()
      )
  );

  if (!safety.safe) {
    throw new Error(
      `Token rejected:\n- ${safety.reasons.join(
        '\n- '
      )}`
    );
  }

  const buyLamports = BigInt(
    Math.floor(
      config.buyAmountSol *
        LAMPORTS_PER_SOL
    )
  );

  const solBalance =
    await rpcPool.call(
      (connection) =>
        connection.getBalance(
          config.walletPublicKey,
          'confirmed'
        )
    );

  const feeReserve =
    config.maxPriorityFeeLamports +
    1_000_000;

  if (
    solBalance <
    Number(buyLamports) + feeReserve
  ) {
    throw new Error(
      `Insufficient SOL balance: ${
        solBalance /
        LAMPORTS_PER_SOL
      }`
    );
  }

  const balanceBefore =
    await getBalanceWithFailover(
      rpcPool,
      config.walletPublicKey,
      outputMint
    );

  const buyQuote = await getQuote(
    SOL_MINT,
    outputMint.toBase58(),
    buyLamports
  );

  const roundTripLoss =
    await checkRoundTrip(buyQuote);

  console.log(
    `Estimated round-trip loss: ${roundTripLoss.toFixed(
      2
    )}%`
  );

  const pendingState: PendingBuyState = {
    version: 1,
    status: 'pending-buy',
    mint: outputMint.toBase58(),
    balanceBeforeRaw:
      balanceBefore.toString(),
    entryLamports:
      buyLamports.toString(),
    createdAt:
      new Date().toISOString(),
  };

  /*
   * Save pending state before broadcasting.
   * A crash can no longer cause an automatic
   * duplicate purchase after restart.
   */
  await saveState(pendingState);

  const builtSwap =
    await buildSwapTransaction(
      buyQuote,
      config.walletPublicKey
    );

  const buySignature =
    await simulateAndSend(
      rpcPool.current(),
      config.keypair,
      builtSwap
    );

  if (buySignature === 'DRY_RUN') {
    await clearState();

    console.log(
      'Dry run completed; nothing was broadcast.'
    );

    return;
  }

  console.log(
    `Buy confirmed: https://solscan.io/tx/${buySignature}`
  );

  const purchasedAmount =
    await waitForBalanceIncrease(
      rpcPool,
      config.walletPublicKey,
      outputMint,
      balanceBefore
    );

  const openPosition: OpenPositionState = {
    version: 1,
    status: 'open',
    mint: outputMint.toBase58(),
    purchasedAmountRaw:
      purchasedAmount.toString(),
    entryLamports:
      buyLamports.toString(),
    buySignature,
    createdAt:
      pendingState.createdAt,
  };

  await saveState(openPosition);

  const exitSignature =
    await monitorAndExit(
      rpcPool,
      openPosition
    );

  console.log(
    `Exit result: ${exitSignature}`
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `Fatal error: ${message}`
  );

  console.error(
    'Position state was preserved. Do not start another purchase before checking it.'
  );

  process.exitCode = 1;
});
