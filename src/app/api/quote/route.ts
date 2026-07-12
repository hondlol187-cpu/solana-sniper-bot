import { NextResponse } from 'next/server';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const JUPITER_API_URL = 'https://lite-api.jup.ag/swap/v1';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

interface JupiterQuote {
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

/**
 * GET /api/quote?outputMint=...&amountSol=...&slippageBps=...
 *
 * Server-side Jupiter Lite API quote fetcher. Needs NO private key — it only
 * reads public market data (price impact, expected output, route). The actual
 * signing happens client-side via Phantom.
 *
 * This mirrors sniper/jupiter.ts getQuote() but is safe to call from the
 * browser (no key exposure, CORS handled server-side).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const outputMint = searchParams.get('outputMint');
  const amountSol = parseFloat(searchParams.get('amountSol') || '0.05');
  const slippageBps = parseInt(searchParams.get('slippageBps') || '300', 10);

  if (!outputMint) {
    return NextResponse.json(
      { error: 'outputMint is required' },
      { status: 400 }
    );
  }

  if (!Number.isFinite(amountSol) || amountSol <= 0 || amountSol > 1) {
    return NextResponse.json(
      { error: 'amountSol must be between 0 and 1 SOL' },
      { status: 400 }
    );
  }

  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) {
    return NextResponse.json(
      { error: 'slippageBps must be between 1 and 5000' },
      { status: 400 }
    );
  }

  const rawAmount = BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL));

  const params = new URLSearchParams({
    inputMint: SOL_MINT,
    outputMint,
    amount: rawAmount.toString(),
    slippageBps: String(slippageBps),
    swapMode: 'ExactIn',
    restrictIntermediateTokens: 'true',
  });

  try {
    const response = await fetch(
      `${JUPITER_API_URL}/quote?${params.toString()}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      return NextResponse.json(
        {
          error: `Jupiter returned HTTP ${response.status}`,
          detail: text.slice(0, 300),
        },
        { status: 502 }
      );
    }

    const quote = (await response.json()) as JupiterQuote;

    // Validate the quote (mirrors sniper/jupiter.ts)
    if (quote.inputMint !== SOL_MINT || quote.outputMint !== outputMint) {
      return NextResponse.json(
        { error: 'Quote mint mismatch' },
        { status: 502 }
      );
    }

    if (!quote.routePlan?.length || BigInt(quote.outAmount) <= 0n) {
      return NextResponse.json(
        { error: 'No valid route returned' },
        { status: 502 }
      );
    }

    // Return a clean, public-safe subset (no sensitive data)
    return NextResponse.json({
      inputMint: quote.inputMint,
      outputMint: quote.outputMint,
      inAmount: quote.inAmount,
      outAmount: quote.outAmount,
      inAmountSol: amountSol,
      outAmountUi: Number(quote.outAmount) / Math.pow(10, 6), // approximate; real decimals need mint lookup
      priceImpactPct: Number(quote.priceImpactPct),
      slippageBps: quote.slippageBps,
      routePlan: quote.routePlan,
      swapMode: quote.swapMode,
      fetchedAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Failed to fetch Jupiter quote', detail: message },
      { status: 500 }
    );
  }
}
