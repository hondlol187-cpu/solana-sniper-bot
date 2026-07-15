export interface SellabilityReport {
  sellable: boolean;
  hardReject: boolean;
  estimatedBuyOutAmount?: string;
  estimatedSellBackAmount?: string;
  effectiveRoundTripLossBps?: number;
  reasons: string[];
  warnings: string[];
}

export interface SellabilityCheckParams {
  mintAddress: string;
  buyAmountLamports: string;
  buyQuoteOutAmount?: string;
  sellQuoteOutAmount?: string;
  sellRouteFound: boolean;
  transferRestrictions: boolean;
  sellTaxBps?: number;
  buyTaxBps?: number;
}

const MAX_ROUND_TRIP_LOSS_BPS = 5000;

export function assessSellability(
  params: SellabilityCheckParams
): SellabilityReport {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let hardReject = false;

  if (!params.sellRouteFound) {
    reasons.push(
      'No sell route found for this token'
    );
    hardReject = true;
  }

  if (params.transferRestrictions) {
    reasons.push(
      'Token has transfer restrictions that may prevent selling'
    );
    hardReject = true;
  }

  const sellTax = params.sellTaxBps ?? 0;
  const buyTax = params.buyTaxBps ?? 0;

  if (sellTax > 5000) {
    reasons.push(
      `Extreme sell tax: ${sellTax} bps (${(sellTax / 100).toFixed(1)}%)`
    );
    hardReject = true;
  } else if (sellTax > 1000) {
    warnings.push(
      `High sell tax: ${sellTax} bps (${(sellTax / 100).toFixed(1)}%)`
    );
  }

  if (buyTax > 5000) {
    reasons.push(
      `Extreme buy tax: ${buyTax} bps (${(buyTax / 100).toFixed(1)}%)`
    );
    hardReject = true;
  }

  let roundTripLossBps: number | undefined;

  if (
    params.buyQuoteOutAmount !== undefined &&
    params.sellQuoteOutAmount !== undefined
  ) {
    const buyOut = BigInt(
      params.buyQuoteOutAmount
    );
    const sellOut = BigInt(
      params.sellQuoteOutAmount
    );
    const buyIn = BigInt(
      params.buyAmountLamports
    );

    if (buyOut > 0n) {
      roundTripLossBps = Number(
        ((buyIn - sellOut) * 10000n) / buyIn
      );

      if (roundTripLossBps > MAX_ROUND_TRIP_LOSS_BPS) {
        reasons.push(
          `Extreme round-trip loss: ${roundTripLossBps} bps (${(roundTripLossBps / 100).toFixed(1)}%)`
        );
        hardReject = true;
      } else if (roundTripLossBps > 2000) {
        warnings.push(
          `Significant round-trip loss: ${roundTripLossBps} bps`
        );
      }
    }
  }

  const sellable = !hardReject;

  return {
    sellable,
    hardReject,
    estimatedBuyOutAmount:
      params.buyQuoteOutAmount,
    estimatedSellBackAmount:
      params.sellQuoteOutAmount,
    effectiveRoundTripLossBps:
      roundTripLossBps,
    reasons,
    warnings,
  };
}