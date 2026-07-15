import type { TokenRiskReport } from './token-risk.js';

import type { HolderEntry } from './token-holders.js';

import {
  analyzeHolderConcentration,
  evaluateHolderRisk,
} from './token-holders.js';

import {
  assessDeployerRisk,
} from './deployer-history.js';

import type { DeployerRiskLevel } from './deployer-history.js';

import {
  assessLpSafety,
} from './lp-safety.js';

export interface TokenRiskAssessmentInput {
  mintAddress: string;
  creatorAddress?: string;
  holders: HolderEntry[];
  totalSupply: string;
  lpParams: {
    lpMintAuthority?: string | null;
    lpFreezeAuthority?: string | null;
    lpOwner?: string;
    isLpBurned?: boolean;
    isLpLocked?: boolean;
  };
  mintSafetyReasons?: string[];
}

export interface RiskConfig {
  topHolderHardRejectPercent: number;
  top5HardRejectPercent: number;
  creatorHardRejectPercent: number;
  maxRiskScoreForSafe: number;
}

const DEFAULT_RISK_CONFIG: RiskConfig = {
  topHolderHardRejectPercent: 40,
  top5HardRejectPercent: 60,
  creatorHardRejectPercent: 20,
  maxRiskScoreForSafe: 70,
};

function computeRiskScore(
  holderRejects: number,
  deployerLevel: DeployerRiskLevel,
  lpRejects: number,
  lpWarnings: number,
  mintSafetyReasons: string[]
): number {
  let score = 0;

  score += Math.min(
    holderRejects * 25,
    50
  );

  score +=
    deployerLevel === 'high'
      ? 30
      : deployerLevel === 'medium'
        ? 15
        : 0;

  score += Math.min(
    lpRejects * 20,
    40
  );

  score += Math.min(
    lpWarnings * 5,
    15
  );

  score += Math.min(
    mintSafetyReasons.length * 10,
    20
  );

  return Math.min(score, 100);
}

export function assessTokenRisk(
  input: TokenRiskAssessmentInput,
  config?: Partial<RiskConfig>
): TokenRiskReport {
  const cfg = {
    ...DEFAULT_RISK_CONFIG,
    ...config,
  };

  const reasons: string[] = [];
  const warnings: string[] = [];
  let hardReject = false;

  const holderAnalysis = analyzeHolderConcentration(
    input.holders,
    input.totalSupply,
    input.creatorAddress
  );

  const holderRisk = evaluateHolderRisk(
    holderAnalysis,
    {
      maxTopHolderPercent:
        cfg.topHolderHardRejectPercent,
      maxTop5Percent:
        cfg.top5HardRejectPercent,
      maxCreatorConcentration:
        cfg.creatorHardRejectPercent,
    }
  );

  reasons.push(...holderRisk.reasons);
  warnings.push(...holderRisk.warnings);

  if (holderRisk.reject) {
    hardReject = true;
  }

  const deployerAssessment = input.creatorAddress
    ? assessDeployerRisk(
        input.creatorAddress
      )
    : { level: 'low' as DeployerRiskLevel, reasons: [] as string[] };

  if (deployerAssessment.level === 'high') {
    reasons.push(
      ...deployerAssessment.reasons
    );
    hardReject = true;
  } else if (
    deployerAssessment.level === 'medium'
  ) {
    warnings.push(
      ...deployerAssessment.reasons
    );
  }

  const lpCheck = assessLpSafety(input.lpParams);

  reasons.push(...lpCheck.reasons);
  warnings.push(...lpCheck.warnings);

  if (lpCheck.reasons.length > 0) {
    hardReject = true;
  }

  const mintReasons =
    input.mintSafetyReasons ?? [];

  reasons.push(...mintReasons);

  if (mintReasons.length > 0) {
    hardReject = true;
  }

  const score = computeRiskScore(
    holderRisk.reasons.length,
    deployerAssessment.level,
    lpCheck.reasons.length,
    lpCheck.warnings.length,
    mintReasons
  );

  return {
    safe:
      !hardReject &&
      score < cfg.maxRiskScoreForSafe,
    score,
    hardReject,
    reasons,
    warnings,
    metrics: {
      topHolderPercent:
        holderAnalysis.topHolderPercent,
      creatorAllocationPercent:
        holderAnalysis.creatorConcentration,
      lpLocked: lpCheck.lpLocked,
      lpBurned: lpCheck.lpBurned,
      knownDeployerRisk:
        deployerAssessment.level,
    },
  };
}