export interface HolderEntry {
  address: string;
  amount: string;
  percent: number;
  isCreator?: boolean;
}

export interface HolderAnalysis {
  topHolderPercent: number;
  top5Percent: number;
  top10Percent: number;
  holderCount: number;
  creatorConcentration?: number;
}

export interface HolderAnalysisConfig {
  maxTopHolderPercent: number;
  maxTop5Percent: number;
  maxTop10Percent: number;
  maxCreatorConcentration: number;
}

const DEFAULT_CONFIG: HolderAnalysisConfig = {
  maxTopHolderPercent: 30,
  maxTop5Percent: 50,
  maxTop10Percent: 70,
  maxCreatorConcentration: 15,
};

export function analyzeHolderConcentration(
  holders: HolderEntry[],
  totalSupply: string,
  creatorAddress?: string,
  config?: Partial<HolderAnalysisConfig>
): HolderAnalysis {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const total = BigInt(totalSupply);

  if (total <= 0n) {
    return {
      topHolderPercent: 100,
      top5Percent: 100,
      top10Percent: 100,
      holderCount: 0,
    };
  }

  const sorted = [...holders].sort(
    (a, b) => b.percent - a.percent
  );

  const topHolder = sorted[0];
  const top5 = sorted.slice(0, 5);
  const top10 = sorted.slice(0, 10);

  const topHolderPercent = topHolder?.percent ?? 100;
  const top5Percent = top5.reduce(
    (sum, h) => sum + h.percent,
    0
  );
  const top10Percent = top10.reduce(
    (sum, h) => sum + h.percent,
    0
  );

  let creatorConcentration: number | undefined;

  if (creatorAddress) {
    const creatorHolder = sorted.find(
      (h) =>
        h.address.toLowerCase() ===
        creatorAddress.toLowerCase()
    );

    if (creatorHolder) {
      creatorConcentration =
        creatorHolder.percent;
    }
  }

  return {
    topHolderPercent,
    top5Percent,
    top10Percent,
    holderCount: holders.length,
    creatorConcentration,
  };
}

export function evaluateHolderRisk(
  analysis: HolderAnalysis,
  config?: Partial<HolderAnalysisConfig>
): {
  reject: boolean;
  reasons: string[];
  warnings: string[];
} {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (analysis.topHolderPercent > cfg.maxTopHolderPercent) {
    reasons.push(
      `Top holder owns ${analysis.topHolderPercent.toFixed(1)}% of supply (max ${cfg.maxTopHolderPercent}%)`
    );
  }

  if (analysis.top5Percent > cfg.maxTop5Percent) {
    reasons.push(
      `Top 5 holders own ${analysis.top5Percent.toFixed(1)}% of supply (max ${cfg.maxTop5Percent}%)`
    );
  }

  if (analysis.top10Percent > cfg.maxTop10Percent) {
    warnings.push(
      `Top 10 holders own ${analysis.top10Percent.toFixed(1)}% of supply (max ${cfg.maxTop10Percent}%)`
    );
  }

  if (
    analysis.creatorConcentration !== undefined &&
    analysis.creatorConcentration >
      cfg.maxCreatorConcentration
  ) {
    reasons.push(
      `Creator holds ${analysis.creatorConcentration.toFixed(1)}% of supply (max ${cfg.maxCreatorConcentration}%)`
    );
  }

  if (analysis.holderCount < 10) {
    warnings.push(
      `Only ${analysis.holderCount} holders detected`
    );
  }

  return {
    reject: reasons.length > 0,
    reasons,
    warnings,
  };
}