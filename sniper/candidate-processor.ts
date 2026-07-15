import type { RaydiumPoolSignal } from './monitor.js';
import type { PumpfunLaunchSignal } from './pumpfun-types.js';

export type CandidateEvent =
  | {
      source: 'raydium';
      signal: RaydiumPoolSignal;
    }
  | {
      source: 'pumpfun';
      signal: PumpfunLaunchSignal;
    };

export function parseCandidateEvent(
  raw: unknown
): CandidateEvent | null {
  if (
    !raw ||
    typeof raw !== 'object'
  ) {
    return null;
  }

  const obj = raw as Record<
    string,
    unknown
  >;

  if (
    obj.source === 'raydium' &&
    obj.signal &&
    typeof obj.signal === 'object'
  ) {
    const sig = obj.signal as Record<
      string,
      unknown
    >;

    if (
      typeof sig.signature === 'string' &&
      typeof sig.slot === 'number'
    ) {
      return {
        source: 'raydium',
        signal: sig as unknown as RaydiumPoolSignal,
      };
    }
  }

  if (
    obj.source === 'pumpfun' &&
    obj.signal &&
    typeof obj.signal === 'object'
  ) {
    return {
      source: 'pumpfun',
      signal: obj.signal as unknown as PumpfunLaunchSignal,
    };
  }

  return null;
}

export function dedupKeyForEvent(
  event: CandidateEvent
): string {
  if (event.source === 'raydium') {
    return `raydium:${event.signal.signature}`;
  }

  return `pumpfun:${event.signal.signature}`;
}