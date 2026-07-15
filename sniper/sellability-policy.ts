// sniper/sellability-policy.ts
import type { SellabilityReport } from './verify-sellability.js';
import type { SellabilityEvidence } from './sellability-evidence.js';

export interface SellabilityPolicyConfig {
  maxSlotLag: number;
  maxAgeSeconds: number;
  requireFullExitRoute: boolean;
  maxQuoteSimulationSlotGap: number;
  maxTransferFeeBps: number;
  maxMaterialQuoteDivergencePct: number;
  approvedRoutePrograms: Set<string>;
}

const DEFAULT_CONFIG: SellabilityPolicyConfig = {
  maxSlotLag: 10,
  maxAgeSeconds: 15,
  requireFullExitRoute: true,
  maxQuoteSimulationSlotGap: 5,
  maxTransferFeeBps: 1000,
  maxMaterialQuoteDivergencePct: 5,
  approvedRoutePrograms: new Set([
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLuZqi5NvAwBNu1',  // Jupiter
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',   // Whirlpool
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',  // Raydium AMM
  ]),
};

export type SellabilityPolicyDecision = 'sellable' | 'unsellable' | 'indeterminate';

export interface SellabilityPolicyResult {
  decision: SellabilityPolicyDecision;
  reasons: string[];
  warnings: string[];
}

export function evaluateSellabilityPolicy(
  evidence: SellabilityEvidence,
  currentSlot: number,
  config?: Partial<SellabilityPolicyConfig>
): SellabilityPolicyResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const reasons: string[] = [];
  const warnings: string[] = [];
  let decision: SellabilityPolicyDecision = 'sellable';

  // Freshness check
  const slotLag = currentSlot - evidence.assessedSlot;
  if (slotLag > cfg.maxSlotLag) {
    reasons.push(`Sellability evidence slot lag ${slotLag} exceeds maximum ${cfg.maxSlotLag}`);
    decision = 'indeterminate';
  }

  const ageSeconds = (Date.now() - new Date(evidence.assessedAt).getTime()) / 1000;
  if (ageSeconds > cfg.maxAgeSeconds) {
    reasons.push(`Sellability evidence age ${Math.round(ageSeconds)}s exceeds maximum ${cfg.maxAgeSeconds}s`);
    decision = 'indeterminate';
  }

  // Full exit route required
  if (cfg.requireFullExitRoute && !evidence.fullExitRouteFound) {
    reasons.push('Full exit route not found — token may only be partially sellable');
    decision = 'unsellable';
  }

  // Small-sell-only detection
  if (evidence.onlySmallestSellSucceeds) {
    reasons.push('Only the smallest exit size succeeded — token appears to be small-sell-only');
    decision = 'unsellable';
  }

  // Quote/simulation divergence
  if (evidence.quoteSimulationSlotGap !== undefined) {
    if (evidence.quoteSimulationSlotGap > cfg.maxQuoteSimulationSlotGap) {
      reasons.push(
        `Quote and simulation slots are ${evidence.quoteSimulationSlotGap} apart, exceeds ${cfg.maxQuoteSimulationSlotGap}`
      );
      decision = 'indeterminate';
    }
  }

  // Material quote divergence
  if (evidence.quoteDivergencePct !== undefined) {
    if (evidence.quoteDivergencePct > cfg.maxMaterialQuoteDivergencePct) {
      reasons.push(
        `Quote output differs materially from simulated output: ${evidence.quoteDivergencePct.toFixed(1)}%`
      );
      decision = 'unsellable';
    }
  }

  // Route program allowlist
  for (const programId of evidence.routeProgramIds) {
    if (!cfg.approvedRoutePrograms.has(programId)) {
      reasons.push(`Unapproved route program: ${programId}`);
      decision = 'unsellable';
    }
  }

  // Transfer fee check
  if (evidence.transferFeeBps !== undefined && evidence.transferFeeBps > cfg.maxTransferFeeBps) {
    reasons.push(`Transfer fee ${evidence.transferFeeBps} bps exceeds threshold ${cfg.maxTransferFeeBps} bps`);
    decision = 'unsellable';
  }

  // Balance mismatch
  if (evidence.balanceChangeMismatch) {
    reasons.push('Token account balance changes do not match expected transfer');
    decision = 'unsellable';
  }

  return { decision, reasons, warnings };
}

export function assertSellabilityEvidenceFresh(params: {
  currentSlot: number;
  evidenceSlot: number;
  maximumSlotLag: number;
}): { fresh: boolean; reason?: string } {
  const lag = params.currentSlot - params.evidenceSlot;

  if (lag > params.maximumSlotLag) {
    return {
      fresh: false,
      reason: `Sellability evidence slot ${params.evidenceSlot} is ${lag} slots behind current slot ${params.currentSlot} (max lag: ${params.maximumSlotLag})`,
    };
  }

  return { fresh: true };
}