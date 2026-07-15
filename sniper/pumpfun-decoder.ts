// sniper/pumpfun-decoder.ts
import type { RawPumpfunEvent } from './pumpfun-event-source.js';
import type { PumpfunLaunchSignal, BondingCurveSnapshot } from './pumpfun-types.js';

const LAUNCH_DISCRIMINATORS = new Set([
  'create',       // Create event
  'buy',          // Buy on bonding curve
  'sell',         // Sell on bonding curve
  'migration',    // Migration to Raydium
]);

export interface DecodedPumpfunEvent {
  raw: RawPumpfunEvent;
  signal?: PumpfunLaunchSignal;
  bondingCurveSnapshot?: BondingCurveSnapshot;
  isMigration: boolean;
  decodeError?: string;
}

export function decodePumpfunEvent(
  raw: RawPumpfunEvent
): DecodedPumpfunEvent {
  const isMigration = raw.discriminator === 'migration';

  // Only create events produce launch signals
  let signal: PumpfunLaunchSignal | undefined;
  if (raw.discriminator === 'create') {
    signal = {
      source: 'pumpfun',
      signature: raw.signature,
      slot: raw.slot,
      mint: raw.mint,
      creator: raw.creator,
      detectedAt: raw.timestamp,
      bondingCurveAccount: raw.bondingCurveAccount,
    };
  }

  let bondingCurveSnapshot: BondingCurveSnapshot | undefined;
  if (raw.bondingCurveAccount) {
    bondingCurveSnapshot = {
      mint: raw.mint,
      bondingCurveAccount: raw.bondingCurveAccount,
      totalSupply: '0',
      tokensReserved: '0',
      solReserved: '0',
      virtualTokenReserves: '0',
      virtualSolReserves: '0',
      realSolReserves: '0',
      tokenTotalSupply: '0',
      complete: isMigration,
      snapshotAt: raw.timestamp,
    };
  }

  return {
    raw,
    signal,
    bondingCurveSnapshot,
    isMigration,
  };
}

export function isValidDiscriminator(
  discriminator: string
): boolean {
  return LAUNCH_DISCRIMINATORS.has(discriminator);
}

export function extractDedupKey(
  raw: RawPumpfunEvent
): string {
  return `${raw.signature}:${raw.instructionIndex}`;
}