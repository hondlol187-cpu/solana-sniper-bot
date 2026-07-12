import {
  Connection,
  Keypair,
  VersionedTransaction,
} from '@solana/web3.js';

import { config } from './config.js';

export const SOL_MINT =
  'So11111111111111111111111111111111111111112';

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
  [key: string]: unknown;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Jupiter returned HTTP ${response.status}: ${text.slice(0, 500)}`
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('Jupiter returned invalid JSON');
  }
}

export async function getQuote(
  inputMint: string,
  outputMint: string,
  rawAmount: bigint
): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint,
    outputMint,
    amount: rawAmount.toString(),
    slippageBps: String(config.slippageBps),
    swapMode: 'ExactIn',
    restrictIntermediateTokens: 'true',
  });

  const response = await fetch(
    `${config.jupiterApiUrl}/quote?${params.toString()}`,
    {
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    }
  );

  const quote = await readJson<JupiterQuote>(response);

  if (quote.inputMint !== inputMint) {
    throw new Error('Quote contains an unexpected input mint');
  }

  if (quote.outputMint !== outputMint) {
    throw new Error('Quote contains an unexpected output mint');
  }

  if (quote.inAmount !== rawAmount.toString()) {
    throw new Error('Quote contains an unexpected input amount');
  }

  if (!quote.routePlan?.length) {
    throw new Error('Jupiter did not return a swap route');
  }

  if (BigInt(quote.outAmount) <= 0n) {
    throw new Error('Quote output amount is zero');
  }

  const priceImpactPct = Number(quote.priceImpactPct);

  if (
    !Number.isFinite(priceImpactPct) ||
    priceImpactPct > config.maxPriceImpactPct
  ) {
    throw new Error(
      `Price impact ${priceImpactPct}% exceeds limit ` +
        `${config.maxPriceImpactPct}%`
    );
  }

  return quote;
}

/**
 * Checks whether Jupiter can quote the token back to SOL.
 * This is useful, but it is not a guarantee that a token is safe.
 */
export async function checkRoundTrip(
  buyQuote: JupiterQuote
): Promise<{
  sellQuote: JupiterQuote;
  estimatedLossPct: number;
}> {
  const sellQuote = await getQuote(
    buyQuote.outputMint,
    SOL_MINT,
    BigInt(buyQuote.outAmount)
  );

  const originalInput = Number(buyQuote.inAmount);
  const returnedAmount = Number(sellQuote.outAmount);

  if (
    !Number.isFinite(originalInput) ||
    !Number.isFinite(returnedAmount) ||
    originalInput <= 0
  ) {
    throw new Error('Invalid round-trip quote amounts');
  }

  const estimatedLossPct =
    ((originalInput - returnedAmount) / originalInput) * 100;

  if (estimatedLossPct > config.maxRoundTripLossPct) {
    throw new Error(
      `Estimated round-trip loss ${estimatedLossPct.toFixed(2)}% ` +
        `exceeds limit ${config.maxRoundTripLossPct}%`
    );
  }

  return {
    sellQuote,
    estimatedLossPct,
  };
}

export async function buildSwapTransaction(
  quote: JupiterQuote,
  wallet: Keypair
): Promise<VersionedTransaction> {
  const response = await fetch(`${config.jupiterApiUrl}/swap`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      quoteResponse: quote,
      userPublicKey: wallet.publicKey.toBase58(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: false,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          priorityLevel: 'high',
          maxLamports: 500_000,
        },
      },
    }),
  });

  const body = await readJson<{
    swapTransaction?: string;
    simulationError?: unknown;
  }>(response);

  if (body.simulationError) {
    throw new Error(
      `Jupiter simulation failed: ${JSON.stringify(
        body.simulationError
      )}`
    );
  }

  if (!body.swapTransaction) {
    throw new Error('Jupiter did not return a swap transaction');
  }

  const transaction = VersionedTransaction.deserialize(
    Buffer.from(body.swapTransaction, 'base64')
  );

  const feePayer = transaction.message.staticAccountKeys[0];

  if (!feePayer?.equals(wallet.publicKey)) {
    throw new Error('Wallet is not the expected transaction fee payer');
  }

  return transaction;
}

export async function simulateAndSend(
  connection: Connection,
  wallet: Keypair,
  transaction: VersionedTransaction
): Promise<string> {
  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: 'processed',
  });

  if (simulation.value.err) {
    throw new Error(
      `Local transaction simulation failed: ${JSON.stringify(
        simulation.value.err
      )}`
    );
  }

  if (!config.liveTrading) {
    console.log('DRY RUN: transaction simulated successfully');
    console.log(
      simulation.value.logs?.join('\n') ?? 'No simulation logs'
    );

    return 'DRY_RUN';
  }

  transaction.sign([wallet]);

  const signature = await connection.sendRawTransaction(
    transaction.serialize(),
    {
      skipPreflight: false,
      maxRetries: 3,
      preflightCommitment: 'confirmed',
    }
  );

  const confirmation = await connection.confirmTransaction(
    signature,
    'confirmed'
  );

  if (confirmation.value.err) {
    throw new Error(
      `Transaction failed: ${JSON.stringify(
        confirmation.value.err
      )}`
    );
  }

  return signature;
}
