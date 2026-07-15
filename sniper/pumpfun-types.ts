export interface PumpfunLaunchSignal {
  source: 'pumpfun';
  signature: string;
  slot: number;
  mint: string;
  creator: string;
  detectedAt: string;
  bondingCurveAccount?: string;
}

export interface BondingCurveSnapshot {
  mint: string;
  bondingCurveAccount: string;
  totalSupply: string;
  tokensReserved: string;
  solReserved: string;
  virtualTokenReserves: string;
  virtualSolReserves: string;
  realSolReserves: string;
  tokenTotalSupply: string;
  complete: boolean;
  snapshotAt: string;
}

export interface PumpfunMigrationCandidate {
  mint: string;
  raydiumPoolAddress?: string;
  migrationSignature?: string;
  migrationDetectedAt: string;
  previousLifecycleStage: string;
  bondingCurveComplete: boolean;
}

export type PumpfunCandidateLifecycle =
  | 'pumpfun_detected'
  | 'migration_detected'
  | 'raydium_pool_validated'
  | 'rejected'
  | 'executed';