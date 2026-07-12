import 'dotenv/config';

import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function numberFromEnv(
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);

  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(
      `${name} must be a number between ${min} and ${max}`
    );
  }

  return value;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();

  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  throw new Error(`${name} must be true or false`);
}

const secretKey = bs58.decode(required('PRIVATE_KEY'));
const keypair = Keypair.fromSecretKey(secretKey);

export const config = {
  rpcUrl: required('RPC_URL'),
  keypair,

  // Trading is disabled unless explicitly enabled.
  liveTrading: booleanFromEnv('LIVE_TRADING', false),

  buyAmountSol: numberFromEnv('BUY_AMOUNT_SOL', 0.01, 0.0001, 0.1),
  slippageBps: numberFromEnv('SLIPPAGE_BPS', 150, 1, 500),
  maxPriceImpactPct: numberFromEnv(
    'MAX_PRICE_IMPACT_PCT',
    3,
    0.01,
    20
  ),
  maxRoundTripLossPct: numberFromEnv(
    'MAX_ROUND_TRIP_LOSS_PCT',
    15,
    0.1,
    50
  ),

  jupiterApiUrl:
    process.env.JUPITER_API_URL?.trim() ??
    'https://lite-api.jup.ag/swap/v1',

  outputMint: required('OUTPUT_MINT'),
};

console.log('Configuration loaded');
console.log(`Wallet: ${keypair.publicKey.toBase58()}`);
console.log(`Mode: ${config.liveTrading ? 'LIVE' : 'DRY RUN'}`);
