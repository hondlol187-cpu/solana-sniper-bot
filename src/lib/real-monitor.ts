import { Connection, PublicKey, type ParsedInstruction } from '@solana/web3.js';

/**
 * Browser-compatible real token monitor.
 *
 * This mirrors sniper/monitor.ts (the CLI version) but is adapted for the
 * Next.js app: no `.js` ESM import suffixes (bundler moduleResolution), and
 * the RPC URL is passed in so the dashboard can configure devnet/mainnet.
 *
 * It subscribes to Raydium AMM v4 logs, detects `initialize2` (new pool
 * creation), fetches + decodes the parsed transaction to extract the real
 * base mint + pool address, then runs on-chain safety checks (mint authority,
 * freeze authority, liquidity). Safe tokens are emitted to the callback.
 */

export const RAYDIUM_AMM_V4 = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

export interface SafeToken {
  mint: string;
  poolAddress: string;
  liquiditySol: number;
  isSafe: boolean;
  reasons: string[];
  detectedAt: string;
}

export interface RealMonitorStatus {
  active: boolean;
  rpcUrl: string;
  lastEventAt: number | null;
  error: string | null;
  detectedCount: number;
}

export async function checkTokenSafety(
  connection: Connection,
  mint: PublicKey,
  poolAddress: PublicKey,
  minLiquiditySol: number
): Promise<{ isSafe: boolean; reasons: string[] }> {
  const reasons: string[] = [];
  try {
    const mintInfo = await connection.getParsedAccountInfo(mint);
    const data = mintInfo.value?.data as any;
    if (data?.parsed?.info?.mintAuthority) reasons.push('Mint authority still active');
    if (data?.parsed?.info?.freezeAuthority) reasons.push('Freeze authority still active');

    const poolInfo = await connection.getAccountInfo(poolAddress);
    if (poolInfo && poolInfo.lamports < minLiquiditySol * 1_000_000_000) {
      reasons.push(`Liquidity below minimum (${minLiquiditySol} SOL)`);
    }
    return { isSafe: reasons.length === 0, reasons };
  } catch {
    return { isSafe: false, reasons: ['Failed to fetch on-chain data'] };
  }
}

/**
 * Start a real onLogs subscription that decodes new Raydium pools.
 * Returns a stop function.
 */
export function startRealTokenMonitor(
  rpcUrl: string,
  minLiquiditySol: number,
  onSafeToken: (token: SafeToken) => void,
  onError: (err: string) => void,
  onStatus: (patch: Partial<RealMonitorStatus>) => void
): () => void {
  let stopped = false;
  let subscriptionId: number | null = null;
  let detectedCount = 0;

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
      async (logs) => {
        if (stopped || logs.err) return;
        const isInitialize = logs.logs?.some((l) => l.includes('initialize2'));
        if (!isInitialize) return;

        onStatus({ lastEventAt: Date.now() });

        try {
          const tx = await connection.getParsedTransaction(logs.signature, {
            maxSupportedTransactionVersion: 0,
          });
          if (!tx?.meta?.innerInstructions) return;

          for (const inner of tx.meta.innerInstructions) {
            for (const ix of inner.instructions) {
              const parsed = ix as ParsedInstruction;
              if (
                parsed.programId?.toString() === RAYDIUM_AMM_V4 &&
                parsed.parsed?.type === 'initialize2'
              ) {
                const info = parsed.parsed.info;
                const baseMint = info?.baseMint;
                const poolAddress = info?.ammAccount || info?.pool;
                if (!baseMint || !poolAddress) continue;

                const { isSafe, reasons } = await checkTokenSafety(
                  connection,
                  new PublicKey(baseMint),
                  new PublicKey(poolAddress),
                  minLiquiditySol
                );

                if (isSafe) {
                  detectedCount += 1;
                  onStatus({ detectedCount, lastEventAt: Date.now() });
                  onSafeToken({
                    mint: baseMint,
                    poolAddress,
                    liquiditySol: 0,
                    isSafe: true,
                    reasons: [],
                    detectedAt: new Date().toISOString(),
                  });
                }
              }
            }
          }
        } catch (err) {
          // Non-fatal: individual tx decode failures shouldn't kill the monitor
          onError(`Decode error: ${(err as Error).message}`);
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
        connection.removeOnLogs(subscriptionId);
      } catch {
        /* ignore */
      }
    }
    onStatus({ active: false });
  };
}
