import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';

import { config } from './config.js';
import {
  buildSwapTransaction,
  checkRoundTrip,
  getQuote,
  simulateAndSend,
  SOL_MINT,
} from './jupiter.js';
import { checkMintSafety } from './safety.js';

async function main(): Promise<void> {
  const connection = new Connection(config.rpcUrl, {
    commitment: 'confirmed',
    confirmTransactionInitialTimeout: 30_000,
  });

  console.log(`Checking token ${config.outputMint}...`);

  const safety = await checkMintSafety(
    connection,
    config.outputMint
  );

  if (!safety.safe) {
    throw new Error(
      `Token rejected:\n- ${safety.reasons.join('\n- ')}`
    );
  }

  console.log('Mint authority checks passed');

  const buyLamports = BigInt(
    Math.floor(config.buyAmountSol * LAMPORTS_PER_SOL)
  );

  const balance = await connection.getBalance(
    config.keypair.publicKey,
    'confirmed'
  );

  const requiredBalance =
    Number(buyLamports) + 1_000_000; // Reserve for fees.

  if (balance < requiredBalance) {
    throw new Error(
      `Insufficient wallet balance. Have ${
        balance / LAMPORTS_PER_SOL
      } SOL`
    );
  }

  console.log('Requesting buy quote...');

  const buyQuote = await getQuote(
    SOL_MINT,
    config.outputMint,
    buyLamports
  );

  console.log(`Expected raw token output: ${buyQuote.outAmount}`);
  console.log(`Price impact: ${buyQuote.priceImpactPct}%`);

  console.log('Checking whether token can be quoted back to SOL...');

  const roundTrip = await checkRoundTrip(buyQuote);

  console.log(
    `Estimated round-trip loss: ` +
      `${roundTrip.estimatedLossPct.toFixed(2)}%`
  );

  const transaction = await buildSwapTransaction(
    buyQuote,
    config.keypair
  );

  const signature = await simulateAndSend(
    connection,
    config.keypair,
    transaction
  );

  if (signature === 'DRY_RUN') {
    console.log(
      'Dry run completed. Set LIVE_TRADING=true only after reviewing everything.'
    );
  } else {
    console.log(`Swap confirmed: ${signature}`);
    console.log(`https://solscan.io/tx/${signature}`);
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : String(error);

  console.error(`Fatal error: ${message}`);
  process.exitCode = 1;
});
