import {
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js';

import { config } from './config.js';
import { audit } from './audit.js';
import { RpcPool } from './rpc.js';

export type PreflightMode =
  | 'new-trade'
  | 'recovery'
  | 'dry-run';

export interface PreflightResult {
  mode: PreflightMode;
  wallet: string;
  solBalanceLamports: number;
  solBalance: number;
  currentSlot: number;
  rpc: string;
  requiredReserveLamports: number;
}

export async function runPreflight(
  rpcPool: RpcPool,
  wallet: PublicKey,
  mode: PreflightMode
): Promise<PreflightResult> {
  /*
   * Recheck the selected RPC immediately before
   * performing wallet or recovery operations.
   */
  await rpcPool.ensureCurrentHealthy();

  const result =
    await rpcPool.call(
      async (connection) => {
        const [
          balance,
          slot,
          blockhash,
        ] = await Promise.all([
          connection.getBalance(
            wallet,
            'confirmed'
          ),

          connection.getSlot(
            'finalized'
          ),

          connection.getLatestBlockhash(
            'confirmed'
          ),
        ]);

        if (
          !blockhash.blockhash ||
          blockhash.lastValidBlockHeight <=
            0
        ) {
          throw new Error(
            'RPC returned an invalid latest blockhash'
          );
        }

        return {
          balance,
          slot,
        };
      }
    );

  const requiredReserveLamports =
    mode === 'recovery'
      ? config
          .recoveryMinimumFeeReserveLamports
      : mode === 'new-trade'
        ? config
            .minimumFeeReserveLamports
        : 0;

  if (
    config.liveTrading &&
    result.balance <
      requiredReserveLamports
  ) {
    const action =
      mode === 'recovery'
        ? 'recover or exit the saved position'
        : 'open a new position';

    throw new Error(
      [
        `Wallet does not have enough SOL to ${action}.`,
        `Mode: ${mode}.`,
        `Required reserve: ${requiredReserveLamports} lamports.`,
        `Available: ${result.balance} lamports.`,
      ].join(' ')
    );
  }

  const preflight: PreflightResult = {
    mode,
    wallet: wallet.toBase58(),
    solBalanceLamports:
      result.balance,
    solBalance:
      result.balance /
      LAMPORTS_PER_SOL,
    currentSlot: result.slot,
    rpc: rpcPool.currentLabel(),
    requiredReserveLamports,
  };

  await audit(
    'preflight.passed',
    preflight
  );

  console.log(
    [
      'Preflight passed.',
      `Mode: ${mode}.`,
      `Cluster: ${config.expectedCluster}.`,
      `RPC: ${preflight.rpc}.`,
      `Balance: ${preflight.solBalance.toFixed(
        6
      )} SOL.`,
    ].join(' ')
  );

  return preflight;
}
