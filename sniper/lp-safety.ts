export interface LpSafetyCheck {
  lpBurned: boolean;
  lpLocked: boolean;
  lpAuthorityRenounced: boolean;
  suspiciousOwnership: boolean;
  reasons: string[];
  warnings: string[];
}

export interface LpSafetyConfig {
  requireBurnOrLock: boolean;
  requireAuthorityRenounced: boolean;
  suspiciousOwnerThreshold: number;
}

const DEFAULT_CONFIG: LpSafetyConfig = {
  requireBurnOrLock: false,
  requireAuthorityRenounced: false,
  suspiciousOwnerThreshold: 50,
};

export function assessLpSafety(
  params: {
    lpMintAuthority?: string | null;
    lpFreezeAuthority?: string | null;
    lpSupply?: string;
    lpTotalSupply?: string;
    lpOwner?: string;
    isLpBurned?: boolean;
    isLpLocked?: boolean;
  },
  config?: Partial<LpSafetyConfig>
): LpSafetyCheck {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const reasons: string[] = [];
  const warnings: string[] = [];

  const lpBurned = params.isLpBurned ?? false;
  const lpLocked = params.isLpLocked ?? false;
  const lpAuthorityRenounced =
    params.lpMintAuthority === null &&
    params.lpFreezeAuthority === null;

  const suspiciousOwnership =
    !lpBurned &&
    !lpLocked &&
    !!params.lpOwner;

  if (cfg.requireBurnOrLock && !lpBurned && !lpLocked) {
    reasons.push(
      'LP is neither burned nor locked'
    );
  }

  if (
    cfg.requireAuthorityRenounced &&
    !lpAuthorityRenounced
  ) {
    reasons.push(
      'LP authority has not been renounced'
    );
  }

  if (suspiciousOwnership) {
    warnings.push(
      'LP has an active owner and is not burned or locked'
    );
  }

  if (params.lpMintAuthority !== null && params.lpMintAuthority !== undefined) {
    warnings.push(
      'LP mint authority is still set'
    );
  }

  if (params.lpFreezeAuthority !== null && params.lpFreezeAuthority !== undefined) {
    warnings.push(
      'LP freeze authority is still set'
    );
  }

  return {
    lpBurned,
    lpLocked,
    lpAuthorityRenounced,
    suspiciousOwnership,
    reasons,
    warnings,
  };
}