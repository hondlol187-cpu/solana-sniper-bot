import { Connection } from '@solana/web3.js';
import { config } from './config.js';
import { buyWithJupiter } from './jupiter.js';

// This is the main entry point for the sniper bot
// Currently demonstrates a working Jupiter swap.
// Expand this file + monitor.ts for full new-launch sniping.

async function main() {
  console.log('🚀 Starting Solana Sniper Bot...');

  const connection = new Connection(config.rpcUrl, 'confirmed');

  // Example: Buy a specific token (replace with the mint you want)
  // For testing, use a known token mint on mainnet or devnet
  const exampleTokenMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC as example (safe for testing)

  console.log(`Attempting to buy ${exampleTokenMint} with ${config.buyAmountSol} SOL...`);

  try {
    const signature = await buyWithJupiter(
      connection,
      config.keypair,
      exampleTokenMint,
      config.buyAmountSol
    );
    console.log('Transaction confirmed:', signature);
  } catch (error) {
    console.error('Swap failed:', error);
  }

  // TODO for real sniper:
  // - Implement monitorNewPools() in monitor.ts using logsSubscribe or gRPC
  // - Add filters (liquidity, authorities, etc.)
  // - Trigger buy automatically on new qualifying tokens
  // - Add sell logic at targetMultiplier
  // - Integrate Jito bundles for faster execution

  console.log('Bot run complete. Edit the code to make it a full autonomous sniper.');
}

main().catch(console.error);
