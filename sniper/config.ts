import 'dotenv/config';

import bs58 from 'bs58';
import { Keypair, PublicKey } from '@solana/web3.js';

function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function numberEnv(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);

  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }

  return value;
}

function booleanEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();

  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  throw new Error(`${name} must be true or false`);
}

function optionalKeypair(): Keypair | null {
  const raw = process.env.PRIVATE_KEY?.trim();

  if (!raw) return null;

  try {
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    throw new Error(
      'PRIVATE_KEY is not a valid base58 Solana secret key'
    );
  }
}

function enumEnv<T extends string>(
  name: string,
  fallback: T,
  allowed: readonly T[]
): T {
  const raw =
    process.env[name]?.trim() ||
    fallback;

  if (!allowed.includes(raw as T)) {
    throw new Error(
      `${name} must be one of: ${allowed.join(', ')}`
    );
  }

  return raw as T;
}

const liveTrading = booleanEnv('LIVE_TRADING', false);
const keypair = optionalKeypair();

if (liveTrading && !keypair) {
  throw new Error(
    'PRIVATE_KEY is required when LIVE_TRADING=true'
  );
}

let walletPublicKey: PublicKey;

try {
  walletPublicKey =
    keypair?.publicKey ??
    new PublicKey(required('WALLET_PUBLIC_KEY'));
} catch {
  throw new Error('WALLET_PUBLIC_KEY is invalid');
}

const configuredPublicKey =
  process.env.WALLET_PUBLIC_KEY?.trim();

if (
  keypair &&
  configuredPublicKey
) {
  let expectedPublicKey: PublicKey;

  try {
    expectedPublicKey =
      new PublicKey(
        configuredPublicKey
      );
  } catch {
    throw new Error(
      'WALLET_PUBLIC_KEY is invalid'
    );
  }

  if (
    !keypair.publicKey.equals(
      expectedPublicKey
    )
  ) {
    throw new Error(
      [
        'PRIVATE_KEY and WALLET_PUBLIC_KEY refer to different wallets.',
        `Private-key wallet: ${keypair.publicKey.toBase58()}.`,
        `Configured wallet: ${expectedPublicKey.toBase58()}.`,
      ].join(' ')
    );
  }
}

function validateJupiterApiUrl(): string {
  const raw =
    process.env.JUPITER_API_URL?.trim() ||
    'https://lite-api.jup.ag/swap/v1';

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      'JUPITER_API_URL is not a valid URL'
    );
  }

  if (url.protocol !== 'https:') {
    throw new Error(
      'JUPITER_API_URL must use HTTPS'
    );
  }

  const allowCustom = booleanEnv(
    'ALLOW_CUSTOM_JUPITER_API',
    false
  );

  const allowedHosts = new Set([
    'lite-api.jup.ag',
    'api.jup.ag',
  ]);

  if (
    !allowCustom &&
    !allowedHosts.has(url.hostname)
  ) {
    throw new Error(
      [
        `Untrusted Jupiter API host: ${url.hostname}.`,
        'Use lite-api.jup.ag or api.jup.ag.',
        'Set ALLOW_CUSTOM_JUPITER_API=true only if you control and trust the endpoint.',
      ].join(' ')
    );
  }

  return raw.replace(/\/+$/, '');
}

export const config = {
  rpcUrl: required('RPC_URL'),
  liveTrading,
  keypair,
  walletPublicKey,
  outputMint: required('OUTPUT_MINT'),

  buyAmountSol: numberEnv(
    'BUY_AMOUNT_SOL',
    0.01,
    0.0001,
    0.1
  ),

  slippageBps: numberEnv(
    'SLIPPAGE_BPS',
    150,
    1,
    500
  ),

  maxPriceImpactPct: numberEnv(
    'MAX_PRICE_IMPACT_PCT',
    3,
    0.01,
    20
  ),

  maxExitPriceImpactPct: numberEnv(
    'MAX_EXIT_PRICE_IMPACT_PCT',
    10,
    0.01,
    50
  ),

  maxRoundTripLossPct: numberEnv(
    'MAX_ROUND_TRIP_LOSS_PCT',
    15,
    0.1,
    50
  ),

  maxPriorityFeeLamports: numberEnv(
    'MAX_PRIORITY_FEE_LAMPORTS',
    500_000,
    0,
    5_000_000
  ),

  targetMultiplier: numberEnv(
    'TARGET_MULTIPLIER',
    2,
    1.01,
    20
  ),

  stopLossPct: numberEnv(
    'STOP_LOSS_PCT',
    30,
    1,
    95
  ),

  pollIntervalSeconds: numberEnv(
    'POLL_INTERVAL_SECONDS',
    3,
    1,
    60
  ),

  maxHoldMinutes: numberEnv(
    'MAX_HOLD_MINUTES',
    30,
    1,
    1440
  ),

  allowToken2022: booleanEnv(
    'ALLOW_TOKEN_2022',
    false
  ),

  jupiterApiUrl:
    validateJupiterApiUrl(),

  rpcUrls: (
    process.env.RPC_URLS?.trim() ||
    required('RPC_URL')
  )
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean),

  stateFile:
    process.env.POSITION_STATE_FILE?.trim() ||
    './sniper-position.json',

  emergencyExitMaxPriceImpactPct: numberEnv(
    'EMERGENCY_EXIT_MAX_PRICE_IMPACT_PCT',
    50,
    1,
    90
  ),

  operationRetries: numberEnv(
    'OPERATION_RETRIES',
    4,
    1,
    10
  ),

  lockFile:
    process.env.PROCESS_LOCK_FILE?.trim() ||
    './sniper-bot.lock',

  exitBalanceCheckAttempts: numberEnv(
    'EXIT_BALANCE_CHECK_ATTEMPTS',
    10,
    1,
    60
  ),

  maxQuoteAgeSeconds: numberEnv(
    'MAX_QUOTE_AGE_SECONDS',
    20,
    5,
    120
  ),

  maxExtraBuyLamports: numberEnv(
    'MAX_EXTRA_BUY_LAMPORTS',
    5_000_000,
    100_000,
    50_000_000
  ),

  maxExitFeeLamports: numberEnv(
    'MAX_EXIT_FEE_LAMPORTS',
    5_000_000,
    100_000,
    50_000_000
  ),

  expectedCluster: enumEnv(
    'EXPECTED_CLUSTER',
    'mainnet-beta',
    [
      'mainnet-beta',
      'devnet',
      'testnet',
    ] as const
  ),

  maxRpcLagSeconds: numberEnv(
    'MAX_RPC_LAG_SECONDS',
    60,
    5,
    600
  ),

  rpcHealthTimeoutMs: numberEnv(
    'RPC_HEALTH_TIMEOUT_MS',
    10_000,
    1_000,
    60_000
  ),

  minimumFeeReserveLamports: numberEnv(
    'MINIMUM_FEE_RESERVE_LAMPORTS',
    10_000_000,
    1_000_000,
    1_000_000_000
  ),

  auditFile:
    process.env.AUDIT_FILE?.trim() ||
    './sniper-audit.jsonl',

  recoveryMinimumFeeReserveLamports: numberEnv(
    'RECOVERY_MINIMUM_FEE_RESERVE_LAMPORTS',
    500_000,
    50_000,
    100_000_000
  ),

  rpcRecheckIntervalSeconds: numberEnv(
    'RPC_RECHECK_INTERVAL_SECONDS',
    30,
    5,
    600
  ),

  minimumValidatedLiquiditySol: numberEnv(
    'MINIMUM_VALIDATED_LIQUIDITY_SOL',
    10,
    0.1,
    100_000
  ),

  maxPoolSignalAgeSeconds: numberEnv(
    'MAX_POOL_SIGNAL_AGE_SECONDS',
    30,
    1,
    600
  ),

  requireFinalizedPoolTransaction: booleanEnv(
    'REQUIRE_FINALIZED_POOL_TRANSACTION',
    true
  ),

  maxPoolOpenDelaySeconds: numberEnv(
    'MAX_POOL_OPEN_DELAY_SECONDS',
    60,
    0,
    86_400
  ),

  maximumConcurrentPoolValidations: numberEnv(
    'MAXIMUM_CONCURRENT_POOL_VALIDATIONS',
    3,
    1,
    20
  ),

  candidateStoreFile:
    process.env.CANDIDATE_STORE_FILE?.trim() ||
    './sniper-candidates.json',

  maximumCandidateRecords: numberEnv(
    'MAXIMUM_CANDIDATE_RECORDS',
    1_000,
    10,
    100_000
  ),

  riskFile:
    process.env.RISK_FILE?.trim() ||
    './sniper-risk.json',

  maxDailySpendSol: numberEnv(
    'MAX_DAILY_SPEND_SOL',
    0.2,
    0.001,
    100
  ),

  maxDailyTrades: numberEnv(
    'MAX_DAILY_TRADES',
    3,
    1,
    1_000
  ),

  maxDailyDrawdownSol: numberEnv(
    'MAX_DAILY_DRAWDOWN_SOL',
    0.1,
    0.001,
    100
  ),

  fileLockTimeoutMs: numberEnv(
    'FILE_LOCK_TIMEOUT_MS',
    10_000,
    500,
    120_000
  ),

  fileLockRetryMs: numberEnv(
    'FILE_LOCK_RETRY_MS',
    50,
    10,
    5_000
  ),

  fileLockStaleSeconds: numberEnv(
    'FILE_LOCK_STALE_SECONDS',
    120,
    10,
    86_400
  ),
};

console.log(`Wallet: ${config.walletPublicKey.toBase58()}`);
console.log(
  `Mode: ${config.liveTrading ? 'LIVE' : 'DRY RUN'}`
);
