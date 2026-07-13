import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';

import { config } from './config.js';

import {
  simulateWithSpendGuard,
} from './transaction-guard.js';

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
  receivedAtMs: number;
  [key: string]: unknown;
}

export interface BuiltSwap {
  transaction: VersionedTransaction;
  lastValidBlockHeight?: number;

  wallet: PublicKey;
  inputMint: string;
  outputMint: string;

  quoteReceivedAtMs: number;

  /*
   * Maximum SOL the transaction is allowed to
   * remove from the wallet.
   */
  expectedMaximumSpendLamports: bigint;
}

async function readJson<T>(
  response: Response
): Promise<T> {
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Jupiter HTTP ${response.status}: ${text.slice(0, 500)}`
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
  rawAmount: bigint,
  maxPriceImpactPct = config.maxPriceImpactPct
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
    `${config.jupiterApiUrl}/quote?${params}`,
    {
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    }
  );

  const quote =
    await readJson<
      Omit<JupiterQuote, 'receivedAtMs'>
    >(response) as JupiterQuote;

  if (
    quote.inputMint !== inputMint ||
    quote.outputMint !== outputMint
  ) {
    throw new Error(
      'Quote contains unexpected mint addresses'
    );
  }

  if (quote.inAmount !== rawAmount.toString()) {
    throw new Error(
      'Quote contains an unexpected input amount'
    );
  }

  if (
    !Array.isArray(quote.routePlan) ||
    quote.routePlan.length === 0
  ) {
    throw new Error('Jupiter returned no route');
  }

  if (
    BigInt(quote.outAmount) <= 0n ||
    BigInt(quote.otherAmountThreshold) <= 0n
  ) {
    throw new Error(
      'Jupiter returned an invalid output amount'
    );
  }

  const priceImpact = Number(quote.priceImpactPct);

  if (
    !Number.isFinite(priceImpact) ||
    priceImpact < 0 ||
    priceImpact > maxPriceImpactPct
  ) {
    throw new Error(
      `Price impact ${priceImpact}% exceeds ${maxPriceImpactPct}%`
    );
  }

  quote.receivedAtMs = Date.now();

  return quote;
}

function assertQuoteFresh(
  receivedAtMs: number
): void {
  const ageMilliseconds =
    Date.now() - receivedAtMs;

  const maximumAgeMilliseconds =
    config.maxQuoteAgeSeconds *
    1_000;

  if (
    !Number.isFinite(ageMilliseconds) ||
    ageMilliseconds < 0 ||
    ageMilliseconds >
      maximumAgeMilliseconds
  ) {
    throw new Error(
      `Jupiter quote expired after ${(
        ageMilliseconds / 1_000
      ).toFixed(1)} seconds`
    );
  }
}

export async function checkRoundTrip(
  buyQuote: JupiterQuote
): Promise<number> {
  const reverseQuote = await getQuote(
    buyQuote.outputMint,
    SOL_MINT,
    BigInt(buyQuote.outAmount)
  );

  const originalInput = Number(buyQuote.inAmount);
  const returnedAmount = Number(reverseQuote.outAmount);

  if (
    !Number.isSafeInteger(originalInput) ||
    !Number.isSafeInteger(returnedAmount) ||
    originalInput <= 0
  ) {
    throw new Error(
      'Unsafe numeric range in round-trip quote'
    );
  }

  const estimatedLossPct =
    ((originalInput - returnedAmount) /
      originalInput) *
    100;

  if (
    estimatedLossPct >
    config.maxRoundTripLossPct
  ) {
    throw new Error(
      `Estimated round-trip loss ${estimatedLossPct.toFixed(
        2
      )}% exceeds ${config.maxRoundTripLossPct}%`
    );
  }

  return estimatedLossPct;
}

function validateSigners(
  transaction: VersionedTransaction,
  wallet: PublicKey
): void {
  const requiredSignatures =
    transaction.message.header.numRequiredSignatures;

  const signerKeys =
    transaction.message.staticAccountKeys.slice(
      0,
      requiredSignatures
    );

  if (
    requiredSignatures !== 1 ||
    signerKeys.length !== 1 ||
    !signerKeys[0]?.equals(wallet)
  ) {
    throw new Error(
      'Transaction requests unexpected signers'
    );
  }

  const feePayer =
    transaction.message.staticAccountKeys[0];

  if (!feePayer?.equals(wallet)) {
    throw new Error(
      'Wallet is not the transaction fee payer'
    );
  }
}

export async function buildSwapTransaction(
  quote: JupiterQuote,
  wallet: PublicKey
): Promise<BuiltSwap> {
  assertQuoteFresh(
    quote.receivedAtMs
  );

  const response = await fetch(
    `${config.jupiterApiUrl}/swap`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        dynamicSlippage: false,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            priorityLevel: 'high',
            maxLamports:
              config.maxPriorityFeeLamports,
          },
        },
      }),
    }
  );

  const body = await readJson<{
    swapTransaction?: string;
    simulationError?: unknown;
    lastValidBlockHeight?: number;
  }>(response);

  if (body.simulationError) {
    throw new Error(
      `Jupiter simulation failed: ${JSON.stringify(
        body.simulationError
      )}`
    );
  }

  if (!body.swapTransaction) {
    throw new Error(
      'Jupiter did not return a swap transaction'
    );
  }

  const transaction =
    VersionedTransaction.deserialize(
      Buffer.from(body.swapTransaction, 'base64')
    );

  validateSigners(transaction, wallet);

  const expectedMaximumSpendLamports =
    quote.inputMint === SOL_MINT
      ? BigInt(quote.inAmount) +
        BigInt(
          config.maxExtraBuyLamports
        )
      : BigInt(
          config.maxExitFeeLamports
        );

  return {
    transaction,

    lastValidBlockHeight:
      body.lastValidBlockHeight,

    wallet,
    inputMint:
      quote.inputMint,
    outputMint:
      quote.outputMint,

    quoteReceivedAtMs:
      quote.receivedAtMs,

    expectedMaximumSpendLamports,
  };
}

export async function simulateAndSend(
  connection: Connection,
  signer: Keypair | null,
  builtSwap: BuiltSwap
): Promise<string> {
  const {
    transaction,
    lastValidBlockHeight,
    wallet,
    quoteReceivedAtMs,
    expectedMaximumSpendLamports,
  } = builtSwap;

  assertQuoteFresh(
    quoteReceivedAtMs
  );

  if (!config.liveTrading) {
    const guard =
      await simulateWithSpendGuard(
        connection,
        transaction,
        wallet,
        {
          expectedMaximumSpendLamports,

          verifySignatures: false,

          /*
           * Dry-run may use an expired transaction
           * blockhash because nothing is broadcast.
           */
          replaceRecentBlockhash: true,
        }
      );

    if (guard.err) {
      throw new Error(
        `Transaction simulation failed: ${JSON.stringify(
          guard.err
        )}`
      );
    }

    console.log(
      `DRY RUN: simulated SOL spend ${guard.simulatedSpendLamports} lamports`
    );

    if (guard.logs.length > 0) {
      console.log(
        guard.logs.join('\n')
      );
    }

    return 'DRY_RUN';
  }

  if (!signer) {
    throw new Error(
      'Live trading requires a signer'
    );
  }

  if (
    !signer.publicKey.equals(wallet)
  ) {
    throw new Error(
      'Signer does not match the transaction wallet'
    );
  }

  transaction.sign([signer]);

  /*
   * Check quote age again immediately before the
   * signed simulation.
   */
  assertQuoteFresh(
    quoteReceivedAtMs
  );

  const guard =
    await simulateWithSpendGuard(
      connection,
      transaction,
      wallet,
      {
        expectedMaximumSpendLamports,

        /*
         * Verify the exact signatures that will be
         * broadcast.
         */
        verifySignatures: true,

        /*
         * Live simulation must use the actual
         * transaction blockhash.
         */
        replaceRecentBlockhash: false,
      }
    );

  if (guard.err) {
    throw new Error(
      `Signed simulation failed: ${JSON.stringify(
        guard.err
      )}`
    );
  }

  console.log(
    `Signed simulation passed; SOL spend ${guard.simulatedSpendLamports} lamports`
  );

  /*
   * Minimize the delay between simulation and
   * broadcasting.
   */
  const signature =
    await connection.sendRawTransaction(
      transaction.serialize(),
      {
        skipPreflight: false,
        maxRetries: 3,
        preflightCommitment:
          'confirmed',
      }
    );

  const confirmation =
    lastValidBlockHeight
      ? await connection.confirmTransaction(
          {
            signature,
            blockhash:
              transaction.message
                .recentBlockhash,
            lastValidBlockHeight,
          },
          'confirmed'
        )
      : await connection.confirmTransaction(
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
