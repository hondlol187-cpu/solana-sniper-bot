import { Connection, PublicKey } from '@solana/web3.js';

/**
 * Browser-compatible Raydium SIGNAL-ONLY monitor.
 *
 * This mirrors sniper/monitor.ts (the CLI signal-only version) but is adapted
 * for the Next.js app: no `.js` ESM import suffixes (bundler moduleResolution),
 * and the RPC URL is passed in so the dashboard can configure devnet/mainnet.
 *
 * IMPORTANT: This monitor only reports transaction signatures that appear
 * related to Raydium initialization. It intentionally does NOT guess account
 * indexes, mint addresses, vault addresses, or liquidity. A signal must never
 * trigger a purchase directly — it must first be decoded by a proper Raydium
 * decoder, passed to validateDecodedRaydiumPool(), then acceptPoolForTrading().
 *
 * The dashboard's simulated pool feed (makePool/spawnPool in sniper-store.ts)
 * is separate and clearly labeled as simulation.
 */

export const RAYDIUM_AMM_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

export interface RaydiumPoolSignal {
  signature: string;
  slot: number;
  programId: string;
  detectedAt: string;
  /** A signal is NOT a validated pool. It must never trigger a purchase. */
  validated: false;
}

export interface RealMonitorStatus {
  active: boolean;
  rpcUrl: string;
  lastEventAt: number | null;
  error: string | null;
  detectedCount: number;
}

/**
 * Start a real onLogs subscription that reports Raydium pool-creation SIGNALS.
 * Returns a stop function. Does NOT decode or validate — signal only.
 */
export function startRaydiumSignalMonitor(
  rpcUrl: string,
  onSignal: (signal: RaydiumPoolSignal) => void,
  onError: (err: string) => void,
  onStatus: (patch: Partial<RealMonitorStatus>) => void
): () => void {
  let stopped = false;
  let subscriptionId: number | null = null;
  let detectedCount = 0;
  const seen = new Set<string>();

  onStatus({ active: true, rpcUrl, error: null, detectedCount: 0, lastEventAt: null });

  let connection: Connection;
  try {
    connection = new Connection(rpcUrl, 'confirmed');
  } catch (err: any) {
    onStatus({ active: false, error: `Invalid RPC URL: ${err?.message || err}` });
    return () => {};
  }

  try {
    subscriptionId = connection.onLogs(
      new PublicKey(RAYDIUM_AMM_V4),
      async (logs, context) => {
        if (stopped || logs.err) return;

        // Only report signatures that appear related to initialization
        const appearsToInitialize = logs.logs?.some((line) => {
          const n = line.toLowerCase();
          return n.includes('initialize2') || n.includes('initialize');
        });
        if (!appearsToInitialize) return;

        // De-duplicate signatures
        if (seen.has(logs.signature)) return;
        seen.add(logs.signature);
        // Cap memory: keep last 10,000 signatures
        if (seen.size > 10_000) {
          const first = seen.values().next().value;
          if (first) seen.delete(first);
        }

        onStatus({ lastEventAt: Date.now() });

        const signal: RaydiumPoolSignal = {
          signature: logs.signature,
          slot: context.slot,
          programId: RAYDIUM_AMM_V4,
          detectedAt: new Date().toISOString(),
          validated: false,
        };

        detectedCount += 1;
        onStatus({ detectedCount, lastEventAt: Date.now() });

        try {
          onSignal(signal);
        } catch (err) {
          onError(`Signal callback error: ${(err as Error).message}`);
        }
      },
      'confirmed'
    );
  } catch (err: any) {
    onStatus({ active: false, error: `Subscription failed: ${err?.message || err}` });
    return () => {};
  }

  return () => {
    stopped = true;
    if (subscriptionId != null) {
      try {
        (connection as any).removeOnLogs(subscriptionId);
      } catch {
        /* ignore */
      }
    }
    onStatus({ active: false });
  };
}
