import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';

const JUPITER_PRICE_API = 'https://lite-api.jup.ag/price/v3';

/**
 * GET /api/price?ids=So11111111111111111111111111111111111111112
 *
 * Fetches token prices from Jupiter Price API v2. Defaults to SOL.
 * Key-less, public market data only.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ids =
    searchParams.get('ids') ||
    'So11111111111111111111111111111111111111112'; // SOL default

  try {
    const response = await fetch(
      `${JUPITER_PRICE_API}?ids=${encodeURIComponent(ids)}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: `Price API returned HTTP ${response.status}` },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      data: data, // v3 returns mint map directly at top level
      fetchedAt: Date.now(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: 'Failed to fetch price', detail: message },
      { status: 500 }
    );
  }
}
