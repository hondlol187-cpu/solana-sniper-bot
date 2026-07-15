// sniper/risk-policy.ts
import type { RiskDecision, RiskEvidenceSource, RiskEvidence } from './risk-evidence.js';

export interface PolicyEvaluation {
  decision: RiskDecision;
  reasons: string[];
  failClosedConditions: string[];
}

const FAIL_CLOSED_REASONS = [
  'holder_pagination_incomplete',
  'source_slot_too_old',
  'lp_ownership_unproven',
  'creator_history_unavailable',
  'provider_response_malformed',
  'provider_disagreement',
];

export function evaluateRiskPolicy(
  evidence: RiskEvidence,
  currentSlot: number,
  config?: {
    maxSlotLag?: number;
    maxAgeSeconds?: number;
    providerDisagreementTolerance?: number;
    indeterminatePolicy?: 'reject' | 'indeterminate';
  }
): PolicyEvaluation {
  const maxSlotLag = config?.maxSlotLag ?? 20;
  const maxAgeSeconds = config?.maxAgeSeconds ?? 20;
  const disagreementTolerance = config?.providerDisagreementTolerance ?? 0;

  const reasons: string[] = [];
  const failClosed: string[] = [];

  const now = Date.now();

  // Check each source for fail-closed conditions
  for (const source of evidence.sources) {
    if (!source.complete) {
      failClosed.push('holder_pagination_incomplete');
      reasons.push(`Provider ${source.provider} returned incomplete data — fail closed`);
    }

    const slotLag = currentSlot - source.observedSlot;
    if (slotLag > maxSlotLag) {
      failClosed.push('source_slot_too_old');
      reasons.push(`Provider ${source.provider} slot lag ${slotLag} exceeds ${maxSlotLag}`);
    }

    const ageMs = now - new Date(source.fetchedAt).getTime();
    if (ageMs > maxAgeSeconds * 1000) {
      failClosed.push('source_slot_too_old');
      reasons.push(`Provider ${source.provider} data age ${Math.round(ageMs / 1000)}s exceeds ${maxAgeSeconds}s`);
    }
  }

  // Check for provider disagreements
  if (evidence.sources.length > 1 && disagreementTolerance >= 0) {
    const slotValues = evidence.sources.map(s => s.observedSlot);
    const maxSlot = Math.max(...slotValues);
    const minSlot = Math.min(...slotValues);

    if (maxSlot - minSlot > maxSlotLag) {
      failClosed.push('provider_disagreement');
      reasons.push(
        `Provider slot disagreement: range ${minSlot}-${maxSlot} exceeds tolerance ${maxSlotLag}`
      );
    }
  }

  const hasFailClosed = failClosed.length > 0;
  const indeterminatePolicy = config?.indeterminatePolicy ?? 'reject';

  let decision: RiskDecision;
  if (hasFailClosed) {
    decision = indeterminatePolicy === 'reject' ? 'reject' : 'indeterminate';
  } else {
    decision = 'allow';
  }

  return {
    decision,
    reasons,
    failClosedConditions: failClosed,
  };
}

export function attachRiskEvidenceHash(
  candidateDecision: Record<string, unknown>,
  riskReportHash: string
): Record<string, unknown> {
  return {
    ...candidateDecision,
    riskReportHash,
  };
}

export function verifyRiskEvidenceBinding(
  executionPlan: Record<string, unknown>,
  expectedRiskHash: string
): { valid: boolean; reason?: string } {
  const planHash = executionPlan.riskReportHash as string | undefined;

  if (!planHash) {
    return { valid: false, reason: 'Execution plan has no risk evidence hash' };
  }

  if (planHash !== expectedRiskHash) {
    return {
      valid: false,
      reason: `Risk evidence hash mismatch: plan has ${planHash}, expected ${expectedRiskHash}`,
    };
  }

  return { valid: true };
}