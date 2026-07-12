import {
  Connection,
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
  monitorAndExit,
  waitForTokenBalance,
} from './position.js';

import { checkMintSafety } from './safety.js';

async function main(): Promise<void> {
  const connection = new Connection(
    config.rpcUrl,
    {
      commitment: 'confirmed',
      confirmTransactionInitialTimeout:
        30_000,
    }
  );

  const outputMint = new PublicKey(
    config.outputMint
  );

  console.log(
    `Checking ${outputMint.toBase58()}...`
  );

  const safety = await checkMintSafety(
    connection,
    outputMint.toBase58()
  );

  if (!safety.safe) {
    throw new Error(
      `Token rejected:\n- ${safety.reasons.join(
        '\n- '
      )}`
    );
  }

  console.log(
    'Token passed preliminary safety checks'
  );

  const buyLamports = BigInt(
    Math.floor(
      config.buyAmountSol *
        LAMPORTS_PER_SOL
    )
  );

  const balance =
    await connection.getBalance(
      config.walletPublicKey,
      'confirmed'
    );

  const feeReserve =
    config.maxPriorityFeeLamports +
    1_000_000;

  if (
    balance <
    Number(buyLamports) + feeReserve
  ) {
    throw new Error(
      `Insufficient SOL balance: ${
        balance / LAMPORTS_PER_SOL
      }`
    );
  }

  const buyQuote = await getQuote(
    SOL_MINT,
    outputMint.toBase58(),
    buyLamports
  );

  console.log(
    `Expected raw output: ${buyQuote.outAmount}`
  );

  console.log(
    `Entry price impact: ${buyQuote.priceImpactPct}%`
  );

  const roundTripLoss =
    await checkRoundTrip(buyQuote);

  console.log(
    `Estimated round-trip loss: ${roundTripLoss.toFixed(
      2
    )}%`
  );

  const builtSwap =
    await buildSwapTransaction(
      buyQuote,
      config.walletPublicKey
    );

  const signature =
    await simulateAndSend(
      connection,
      config.keypair,
      builtSwap
    );

  if (signature === 'DRY_RUN') {
    console.log(
      'Dry run completed; nothing was signed or broadcast.'
    );

    return;
  }

  console.log(
    `Buy confirmed: https://solscan.io/tx/${signature}`
  );

  /*
   * Read the actual received balance instead of assuming
   * that Jupiter's quoted output was received.
   */
  const actualTokenAmount =
    await waitForTokenBalance(
      connection,
      config.walletPublicKey,
      outputMint
    );

  console.log(
    `Actual raw token balance: ${actualTokenAmount}`
  );

  const exitSignature =
    await monitorAndExit(
      connection,
      outputMint,
      buyLamports
    );

  console.log(
    `Exit confirmed: https://solscan.io/tx/${exitSignature}`
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(`Fatal error: ${message}`);
  process.exitCode = 1;
});
