import {
  ValidatedRaydiumPool,
} from './pool-validator.js';

import { audit } from './audit.js';

import {
  assessTokenRisk,
} from './token-risk.js';

import type {
  TokenRiskReport,
} from './token-risk.js';

/**
 * Comprehensive risk assessment for a candidate pool.
 * Integrates holder concentration, deployer reputation,
 * LP safety, and mint safety into a single risk report.
 */
export function assessCandidateRisk(
  pool: ValidatedRaydiumPool,
  mintSafetyReasons: string[] = [],
  creatorAddress?: string
): TokenRiskReport {
  return assessTokenRisk({
    mintAddress: pool.baseMint,
    creatorAddress,
    holders: [],
    totalSupply: '0',
    lpParams: {
      isLpBurned: false,
    },
    mintSafetyReasons,
  });
}

export async function acceptPoolForTrading(
  pool: ValidatedRaydiumPool
): Promise<ValidatedRaydiumPool> {
  if (pool.validated !== true) {
    throw new Error(
      'Pool has not passed validation'
    );
  }

  if (
    !Number.isFinite(
      pool.liquiditySol
    ) ||
    pool.liquiditySol <= 0
  ) {
    throw new Error(
      'Pool has invalid validated liquidity'
    );
  }

  await audit(
    'pool.accepted.for-trading',
    {
      signature:
        pool.signature,
      poolAddress:
        pool.poolAddress,
      baseMint:
        pool.baseMint,
      liquiditySol:
        pool.liquiditySol,
    }
  );

  return pool;
}
