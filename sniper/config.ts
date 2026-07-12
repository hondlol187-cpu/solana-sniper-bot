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
    process.env.JUPITER_API_URL?.trim() ??
    'https://lite-api.jup.ag/swap/v1',

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
};

console.log(`Wallet: ${config.walletPublicKey.toBase58()}`);
console.log(
  `Mode: ${config.liveTrading ? 'LIVE' : 'DRY RUN'}`
);
