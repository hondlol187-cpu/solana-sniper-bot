import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { config } from './config.js';

export const RAYDIUM_AMM_V4 = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
export const PUMP_FUN = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');

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

    if (data?.parsed?.info?.mintAuthority) reasons.push('Mint authority active');
    if (data?.parsed?.info?.freezeAuthority) reasons.push('Freeze authority active');

    const poolInfo = await connection.getAccountInfo(poolAddress);
    if (poolInfo && poolInfo.lamports < config.minLiquiditySol * LAMPORTS_PER_SOL) {
      reasons.push(`Liquidity too low (< ${config.minLiquiditySol} SOL)`);
    }

    // TODO: Add top holder %, LP lock check, dev wallet tracking

    return { isSafe: reasons.length === 0, reasons };
  } catch {
    return { isSafe: false, reasons: ['Failed to fetch account data'] };
  }
}

export function startTokenMonitor(
  connection: Connection,
  onSafeToken: (token: SafeToken) => void
): () => void {
  console.log('🔍 Starting improved token monitor...');

  const subId = connection.onLogs(
    RAYDIUM_AMM_V4,
    async (logs) => {
      if (logs.err) return;

      const isNewPool = logs.logs?.some(l =>
        l.includes('initialize2') || l.includes('Initialize')
      );
      if (!isNewPool) return;

      // TODO: Replace with real instruction decoding
      const mint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
      const pool = '11111111111111111111111111111111';

      const { isSafe, reasons } = await checkTokenSafety(
        connection,
        new PublicKey(mint),
        new PublicKey(pool)
      );

      if (isSafe) {
        onSafeToken({
          mint,
          poolAddress: pool,
          liquiditySol: 50,
          isSafe: true,
          reasons: [],
          detectedAt: new Date().toISOString(),
        });
      } else {
        console.log('🚫 Filtered unsafe token:', reasons);
      }
    },
    'confirmed'
  );

  return () => connection.removeOnLogs(subId);
}
