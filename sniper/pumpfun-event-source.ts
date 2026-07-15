// sniper/pumpfun-event-source.ts
import type { PumpfunLaunchSignal } from './pumpfun-types.js';

export interface RawPumpfunEvent {
  programId: string;
  instructionIndex: number;
  discriminator: string;
  mint: string;
  creator: string;
  bondingCurveAccount?: string;
  associatedBondingCurve?: string;
  signature: string;
  slot: number;
  success: boolean;
  version: number;
  timestamp: string;
}

export interface EventProviderHealth {
  connected: boolean;
  lastEventAt: string | null;
  lastErrorAt: string | null;
  reconnectCount: number;
  totalEventsProcessed: number;
}

export interface PumpfunEventProvider {
  connect(signal: AbortSignal): Promise<void>;
  subscribe(
    onEvent: (event: RawPumpfunEvent) => Promise<void>,
    signal: AbortSignal
  ): Promise<void>;
  health(): Promise<EventProviderHealth>;
  close(): Promise<void>;
}

const KNOWN_PUMPFUN_PROGRAM_IDS = new Set([
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
  'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1',
]);

export function isKnownPumpfunProgram(
  programId: string
): boolean {
  return KNOWN_PUMPFUN_PROGRAM_IDS.has(programId);
}

export function validateRawEvent(
  event: unknown
): { valid: boolean; event?: RawPumpfunEvent; error?: string } {
  if (!event || typeof event !== 'object') {
    return { valid: false, error: 'Event must be an object' };
  }

  const obj = event as Record<string, unknown>;

  if (typeof obj.programId !== 'string' || !obj.programId) {
    return { valid: false, error: 'Missing or invalid programId' };
  }

  if (!isKnownPumpfunProgram(obj.programId)) {
    return { valid: false, error: `Unknown program ID: ${obj.programId}` };
  }

  if (typeof obj.mint !== 'string' || !obj.mint) {
    return { valid: false, error: 'Missing or invalid mint' };
  }

  if (typeof obj.creator !== 'string' || !obj.creator) {
    return { valid: false, error: 'Missing or invalid creator' };
  }

  if (typeof obj.signature !== 'string' || !obj.signature) {
    return { valid: false, error: 'Missing or invalid signature' };
  }

  if (typeof obj.slot !== 'number' || obj.slot <= 0) {
    return { valid: false, error: 'Missing or invalid slot' };
  }

  if (typeof obj.success !== 'boolean') {
    return { valid: false, error: 'Missing or invalid success field' };
  }

  if (!obj.success) {
    return { valid: false, error: 'Transaction was not successful' };
  }

  if (typeof obj.version !== 'number') {
    return { valid: false, error: 'Missing or invalid version' };
  }

  // Reject unknown instruction versions
  const MAX_KNOWN_VERSION = 2;
  if (obj.version > MAX_KNOWN_VERSION) {
    return {
      valid: false,
      error: `Unknown event version: ${obj.version} (max known: ${MAX_KNOWN_VERSION})`,
    };
  }

  if (typeof obj.instructionIndex !== 'number') {
    return { valid: false, error: 'Missing or invalid instructionIndex' };
  }

  if (typeof obj.discriminator !== 'string') {
    return { valid: false, error: 'Missing or invalid discriminator' };
  }

  return {
    valid: true,
    event: {
      programId: obj.programId,
      instructionIndex: obj.instructionIndex,
      discriminator: obj.discriminator,
      mint: obj.mint,
      creator: obj.creator,
      bondingCurveAccount: typeof obj.bondingCurveAccount === 'string' ? obj.bondingCurveAccount : undefined,
      associatedBondingCurve: typeof obj.associatedBondingCurve === 'string' ? obj.associatedBondingCurve : undefined,
      signature: obj.signature,
      slot: obj.slot,
      success: obj.success,
      version: obj.version,
      timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : new Date().toISOString(),
    },
  };
}