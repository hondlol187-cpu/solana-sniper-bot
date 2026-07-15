import type {
  PumpfunLaunchSignal,
  BondingCurveSnapshot,
} from './pumpfun-types.js';

export interface PumpfunDetectionResult {
  signal: PumpfunLaunchSignal;
  accepted: boolean;
  rejectionReason?: string;
}

const PUMPFUN_PROGRAM_ID =
  '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

function isValidBase58(
  value: string,
  label: string
): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }

  if (value.length < 32 || value.length > 44) {
    return false;
  }

  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(value)) {
    return false;
  }

  return true;
}

export function parsePumpfunLaunchEvent(
  signature: string,
  slot: number,
  logs: string[]
): PumpfunDetectionResult {
  if (!isValidBase58(signature, 'signature')) {
    return {
      signal: {
        source: 'pumpfun',
        signature: '',
        slot: 0,
        mint: '',
        creator: '',
        detectedAt: new Date().toISOString(),
      },
      accepted: false,
      rejectionReason:
        'Invalid transaction signature',
    };
  }

  const joinedLogs = logs
    .join('\n')
    .toLowerCase();

  const hasInitialize =
    joinedLogs.includes('initialize') &&
    (joinedLogs.includes('bonding') ||
      joinedLogs.includes('curve') ||
      joinedLogs.includes('pump'));

  if (!hasInitialize) {
    return {
      signal: {
        source: 'pumpfun',
        signature,
        slot,
        mint: '',
        creator: '',
        detectedAt: new Date().toISOString(),
      },
      accepted: false,
      rejectionReason:
        'Logs do not indicate Pump.fun bonding curve initialization',
    };
  }

  const mintMatch = logs
    .join('\n')
    .match(
      /mint[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i
    );

  const creatorMatch = logs
    .join('\n')
    .match(
      /creator[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i
    );

  const bondingCurveMatch = logs
    .join('\n')
    .match(
      /bonding[_\s]?curve[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i
    ) ?? logs
      .join('\n')
      .match(
        /bonding_curve[=:]\s*([1-9A-HJ-NP-Za-km-z]{32,44})/i
      );

  if (!mintMatch || !creatorMatch) {
    return {
      signal: {
        source: 'pumpfun',
        signature,
        slot,
        mint: mintMatch?.[1] ?? '',
        creator: creatorMatch?.[1] ?? '',
        detectedAt: new Date().toISOString(),
        bondingCurveAccount:
          bondingCurveMatch?.[1],
      },
      accepted: false,
      rejectionReason:
        'Could not extract mint and creator from logs',
    };
  }

  const signal: PumpfunLaunchSignal = {
    source: 'pumpfun',
    signature,
    slot,
    mint: mintMatch[1],
    creator: creatorMatch[1],
    detectedAt: new Date().toISOString(),
    bondingCurveAccount:
      bondingCurveMatch?.[1],
  };

  return { signal, accepted: true };
}

export function captureBondingCurveSnapshot(
  mint: string,
  bondingCurveAccount: string,
  data: {
    virtualTokenReserves: string;
    virtualSolReserves: string;
    realSolReserves: string;
    tokenTotalSupply: string;
    complete: boolean;
  }
): BondingCurveSnapshot {
  return {
    mint,
    bondingCurveAccount,
    totalSupply: data.tokenTotalSupply,
    tokensReserved: data.virtualTokenReserves,
    solReserved: data.virtualSolReserves,
    virtualTokenReserves:
      data.virtualTokenReserves,
    virtualSolReserves:
      data.virtualSolReserves,
    realSolReserves:
      data.realSolReserves,
    tokenTotalSupply:
      data.tokenTotalSupply,
    complete: data.complete,
    snapshotAt: new Date().toISOString(),
  };
}

export async function emitPumpfunAuditEvents(
  event: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    const { audit } = await import('./audit.js');
    await audit(event, details);
  } catch {
    /* audit not available in test env */
  }
}