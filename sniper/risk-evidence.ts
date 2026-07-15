// sniper/risk-evidence.ts
export interface RiskEvidenceSource {
  provider: string;
  observedSlot: number;
  observedAt: string;
  fetchedAt: string;
  requestId?: string;
  complete: boolean;
}

export interface RiskEvidence {
  mintAddress: string;
  sources: RiskEvidenceSource[];
  assessedAt: string;
  reportHash: string;
}

export interface RiskEvidenceBundle {
  evidence: RiskEvidence;
  decision: RiskDecision;
  policyVersion: string;
}

export type RiskDecision = 'allow' | 'warn' | 'reject' | 'indeterminate';

export interface EvidenceFreshnessConfig {
  maxSlotLag: number;
  maxAgeSeconds: number;
  indeterminatePolicy: RiskDecision;
  maxTopHolderPercent: number;
  maxTop10HolderPercent: number;
}

const DEFAULT_FRESHNESS_CONFIG: EvidenceFreshnessConfig = {
  maxSlotLag: 20,
  maxAgeSeconds: 20,
  indeterminatePolicy: 'reject',
  maxTopHolderPercent: 20,
  maxTop10HolderPercent: 60,
};

// System/program-owned accounts that should be excluded
// from holder concentration analysis.
// This allowlist must be explicitly audited.
export const SYSTEM_ACCOUNT_ALLOWLIST = new Set([
  '11111111111111111111111111111111',        // System Program
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',  // Token Program
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',  // Associated Token Program
  'SysvarRent111111111111111111111111111111111',     // Rent Sysvar
  '11111111111111111111111111111111',                // System Program (duplicate safety)
]);

export function isSystemAccount(address: string): boolean {
  return SYSTEM_ACCOUNT_ALLOWLIST.has(address);
}

export function checkEvidenceFreshness(
  evidence: RiskEvidence,
  currentSlot: number,
  currentTime: string,
  config?: Partial<EvidenceFreshnessConfig>
): { fresh: boolean; issues: string[] } {
  const cfg = { ...DEFAULT_FRESHNESS_CONFIG, ...config };
  const issues: string[] = [];

  const assessedAt = new Date(evidence.assessedAt).getTime();
  const currentAt = new Date(currentTime).getTime();
  const ageSeconds = (currentAt - assessedAt) / 1000;

  if (ageSeconds > cfg.maxAgeSeconds) {
    issues.push(`Evidence age ${Math.round(ageSeconds)}s exceeds maximum ${cfg.maxAgeSeconds}s`);
  }

  for (const source of evidence.sources) {
    if (!source.complete) {
      issues.push(`Source ${source.provider} reported incomplete data`);
    }

    const slotLag = currentSlot - source.observedSlot;
    if (slotLag > cfg.maxSlotLag) {
      issues.push(
        `Source ${source.provider} slot lag ${slotLag} exceeds maximum ${cfg.maxSlotLag}`
      );
    }

    const sourceAgeSeconds = (currentAt - new Date(source.fetchedAt).getTime()) / 1000;
    if (sourceAgeSeconds > cfg.maxAgeSeconds) {
      issues.push(
        `Source ${source.provider} fetched ${Math.round(sourceAgeSeconds)}s ago, exceeds maximum ${cfg.maxAgeSeconds}s`
      );
    }
  }

  return { fresh: issues.length === 0, issues };
}

export function resolveEvidenceDecision(
  freshness: { fresh: boolean; issues: string[] },
  baseRiskSafe: boolean,
  config?: Partial<EvidenceFreshnessConfig>
): RiskDecision {
  const cfg = { ...DEFAULT_FRESHNESS_CONFIG, ...config };

  if (!freshness.fresh) {
    return cfg.indeterminatePolicy === 'reject' ? 'reject' : 'indeterminate';
  }

  if (baseRiskSafe) {
    return 'allow';
  }

  return 'reject';
}

export function computeRiskReportHash(
  mintAddress: string,
  sources: RiskEvidenceSource[]
): string {
  // Simple deterministic hash for evidence binding
  const parts = sources
    .map(s => `${s.provider}:${s.observedSlot}:${s.complete}`)
    .sort()
    .join('|');

  let hash = 0;
  const input = `${mintAddress}:${parts}`;

  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit int
  }

  return Math.abs(hash).toString(16).padStart(8, '0');
}

export function buildRiskEvidence(
  mintAddress: string,
  sources: RiskEvidenceSource[],
  baseRiskSafe: boolean,
  currentSlot: number,
  config?: Partial<EvidenceFreshnessConfig>
): RiskEvidenceBundle {
  const assessedAt = new Date().toISOString();
  const reportHash = computeRiskReportHash(mintAddress, sources);

  const evidence: RiskEvidence = {
    mintAddress,
    sources,
    assessedAt,
    reportHash,
  };

  const freshness = checkEvidenceFreshness(
    evidence,
    currentSlot,
    assessedAt,
    config
  );

  const decision = resolveEvidenceDecision(freshness, baseRiskSafe, config);

  return {
    evidence,
    decision,
    policyVersion: '1.0.0',
  };
}