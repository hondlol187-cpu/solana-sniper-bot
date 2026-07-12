import { Connection, PublicKey, LAMPORTS_PER_SOL, ParsedInstruction } from '@solana/web3.js';
import { config } from './config.js';

export const RAYDIUM_AMM_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

export interface SafeToken {
  mint: string;
  poolAddress: string;
  liquiditySol: number;
  isSafe: boolean;
  reasons: string[];
  detectedAt: string;
}

export async function checkTokenSafety(
  connection: Connection,
  mint: PublicKey,
  poolAddress: PublicKey
): Promise<{ isSafe: boolean; reasons: string[] }> {
  const reasons: string[] = [];

  try {
    const mintInfo = await connection.getParsedAccountInfo(mint);
    const data = mintInfo.value?.data as any;

    if (data?.parsed?.info?.mintAuthority) reasons.push('Mint authority still active');
    if (data?.parsed?.info?.freezeAuthority) reasons.push('Freeze authority still active');

    const poolInfo = await connection.getAccountInfo(poolAddress);
    if (poolInfo && poolInfo.lamports < config.minLiquiditySol * LAMPORTS_PER_SOL) {
      reasons.push(`Liquidity below minimum (${config.minLiquiditySol} SOL)`);
    }

    return { isSafe: reasons.length === 0, reasons };
  } catch {
    return { isSafe: false, reasons: ['Failed to fetch on-chain data'] };
  }
}

/**
 * Real new pool detection with instruction decoding
 */
export function startRealTokenMonitor(
  connection: Connection,
  onSafeToken: (token: SafeToken) => void
): () => void {
  console.log('🔍 Starting REAL token monitor with decoding...');

  const subscriptionId = connection.onLogs(
    RAYDIUM_AMM_V4,
    async (logs, ctx) => {
      if (logs.err) return;

      // Look for initialize2 (new pool creation)
      const isInitialize = logs.logs?.some(log => log.includes('initialize2'));
      if (!isInitialize) return;

      try {
        // Fetch the full transaction to decode instructions
        const tx = await connection.getParsedTransaction(logs.signature, {
          maxSupportedTransactionVersion: 0,
        });

        if (!tx?.meta?.innerInstructions) return;

        // Find the initialize2 instruction
        for (const inner of tx.meta.innerInstructions) {
          for (const ix of inner.instructions) {
            const parsed = ix as ParsedInstruction;
            if (
              parsed.programId?.toString() === RAYDIUM_AMM_V4.toString() &&
              parsed.parsed?.type === 'initialize2'
            ) {
              const info = parsed.parsed.info;
              const baseMint = info?.baseMint;
              const poolAddress = info?.ammAccount || info?.pool;

              if (!baseMint || !poolAddress) continue;

              const { isSafe, reasons } = await checkTokenSafety(
                connection,
                new PublicKey(baseMint),
                new PublicKey(poolAddress)
              );

              if (isSafe) {
                onSafeToken({
                  mint: baseMint,
                  poolAddress: poolAddress,
                  liquiditySol: 0, // You can fetch real liquidity later
                  isSafe: true,
                  reasons: [],
                  detectedAt: new Date().toISOString(),
                });
              } else {
                console.log('🚫 Filtered unsafe token:', reasons);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error decoding transaction:', err);
      }
    },
    'confirmed'
  );

  return () => connection.removeOnLogs(subscriptionId);
}
