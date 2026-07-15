// sniper/sellability-evidence.ts
export interface SellabilitySimulationResult {
  exitSizePct: number;
  routeAvailable: boolean;
  expectedOutput: string;
  priceImpactPct: number;
  roundTripLossPct: number;
  simulationSlot: number;
  routeProgramIds: string[];
  tokenBalanceChange: string;
  simulationLogs: string[];
  success: boolean;
  error?: string;
}

export interface SellabilityEvidence {
  version: 1;
  mintAddress: string;
  planId: string;
  assessedAt: string;
  assessedSlot: number;
  simulations: SellabilitySimulationResult[];
  fullExitRouteFound: boolean;
  onlySmallestSellSucceeds: boolean;
  quoteSimulationSlotGap?: number;
  quoteDivergencePct?: number;
  routeProgramIds: string[];
  transferFeeBps?: number;
  balanceChangeMismatch: boolean;
}

export interface AdversarialSimulationConfig {
  exitSizes: number[];
  maxPriceImpactPct: number;
  maxRoundTripLossPct: number;
  requireAllSizesSucceed: boolean;
}

const DEFAULT_ADVERSARIAL_CONFIG: AdversarialSimulationConfig = {
  exitSizes: [10, 50, 100],
  maxPriceImpactPct: 30,
  maxRoundTripLossPct: 50,
  requireAllSizesSucceed: true,
};

export function buildSellabilityEvidence(params: {
  mintAddress: string;
  planId: string;
  simulations: SellabilitySimulationResult[];
  config?: Partial<AdversarialSimulationConfig>;
}): SellabilityEvidence {
  const cfg = { ...DEFAULT_ADVERSARIAL_CONFIG, ...params.config };
  const allProgramIds = new Set<string>();

  for (const sim of params.simulations) {
    for (const programId of sim.routeProgramIds) {
      allProgramIds.add(programId);
    }
  }

  const successes = params.simulations.filter(s => s.success && s.routeAvailable);
  const fullExit = successes.find(s => s.exitSizePct === 100);

  // Detect small-sell-only: only smallest size succeeds
  const onlySmallestSucceeds =
    successes.length === 1 &&
    successes[0].exitSizePct === cfg.exitSizes[0];

  // Check for balance mismatches
  let balanceChangeMismatch = false;
  for (const sim of params.simulations) {
    if (sim.success && sim.tokenBalanceChange === '0') {
      balanceChangeMismatch = true;
      break;
    }
  }

  return {
    version: 1,
    mintAddress: params.mintAddress,
    planId: params.planId,
    assessedAt: new Date().toISOString(),
    assessedSlot: Math.max(...params.simulations.map(s => s.simulationSlot), 0),
    simulations: params.simulations,
    fullExitRouteFound: !!fullExit,
    onlySmallestSellSucceeds: onlySmallestSucceeds,
    routeProgramIds: Array.from(allProgramIds),
    balanceChangeMismatch,
  };
}