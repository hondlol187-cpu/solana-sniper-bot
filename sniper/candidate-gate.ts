import {
  ValidatedRaydiumPool,
} from './pool-validator.js';

import { audit } from './audit.js';

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
