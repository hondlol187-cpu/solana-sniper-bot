'use client';

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';

interface SolPrice {
  usd: number;
  change24h?: number;
}

export function SolPriceTicker() {
  const [price, setPrice] = useState<SolPrice | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchPrice() {
      try {
        const res = await fetch('/api/price?ids=So11111111111111111111111111111111111111112', {
          signal: AbortSignal.timeout(8_000),
        });
        if (!res.ok) return;
        const json = await res.json();
        const solData = json?.data?.['So11111111111111111111111111111111111111112'];
        if (solData?.usdPrice && !cancelled) {
          setPrice({
            usd: Number(solData.usdPrice),
            change24h: solData.priceChange24h ? Number(solData.priceChange24h) : undefined,
          });
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPrice();
    // Refresh every 30 seconds
    const id = setInterval(fetchPrice, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (loading) {
    return (
      <Badge variant="outline" className="border-border bg-muted px-3 py-1.5 text-muted-foreground">
        SOL $…
      </Badge>
    );
  }

  if (!price) return null;

  const positive = (price.change24h ?? 0) >= 0;

  return (
    <Badge
      variant="outline"
      className="gap-1.5 border-border bg-muted px-3 py-1.5"
      title="Live SOL/USD price (Jupiter Price API, refreshes every 30s)"
    >
      <span className="text-muted-foreground">SOL</span>
      <span className="font-semibold tabular-nums">${price.usd.toFixed(2)}</span>
      {price.change24h != null && (
        <span
          className={`text-xs tabular-nums ${
            positive ? 'text-emerald-400' : 'text-red-400'
          }`}
        >
          {positive ? '+' : ''}
          {price.change24h.toFixed(2)}%
        </span>
      )}
    </Badge>
  );
}
