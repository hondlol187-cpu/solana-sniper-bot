import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import { config } from './config.js';

// Jupiter API v6 helper for reliable swaps
// This makes the bot immediately usable for real trades

export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: number, // in lamports or raw
  slippageBps: number
) {
  const url = `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=${slippageBps}&onlyDirectRoutes=false`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to get Jupiter quote');
  return response.json();
}

export async function executeSwap(
  connection: Connection,
  wallet: Keypair,
  quoteResponse: any
) {
  const swapResponse = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: 'auto',
    }),
  });

  const { swapTransaction } = await swapResponse.json();

  const transaction = VersionedTransaction.deserialize(
    Buffer.from(swapTransaction, 'base64')
  );

  transaction.sign([wallet]);

  const signature = await connection.sendTransaction(transaction, {
    skipPreflight: false,
  });

  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

// Example: Buy a token with SOL using Jupiter
export async function buyWithJupiter(
  connection: Connection,
  wallet: Keypair,
  outputMint: string, // token to buy
  solAmount: number
) {
  const lamports = Math.floor(solAmount * 1_000_000_000);

  const quote = await getQuote(
    'So11111111111111111111111111111111111111112', // SOL
    outputMint,
    lamports,
    config.slippageBps
  );

  console.log('Quote received. Executing swap...');
  const signature = await executeSwap(connection, wallet, quote);
  console.log('✅ Swap successful! Signature:', signature);
  return signature;
}
