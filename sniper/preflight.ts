import {
  LAMPORTS_PER_SOL,
  PublicKey,
} from '@solana/web3.js';

import { config } from './config.js';
import { audit } from './audit.js';
import { RpcPool } from './rpc.js';

export interface PreflightResult {
  wallet: string;
  solBalanceLamports: number;
  solBalance: number;
  currentSlot: number;
  rpc: string;
}

export async function runPreflight(
  rpcPool: RpcPool,
  wallet: PublicKey
): Promise<PreflightResult> {
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
            'processed'
          ),

          connection.getLatestBlockhash(
            'processed'
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

  if (
    config.liveTrading &&
    result.balance <
      config.minimumFeeReserveLamports
  ) {
    throw new Error(
      [
        'Wallet does not have the minimum fee reserve.',
        `Required: ${config.minimumFeeReserveLamports} lamports.`,
        `Available: ${result.balance} lamports.`,
      ].join(' ')
    );
  }

  const preflight: PreflightResult = {
    wallet: wallet.toBase58(),
    solBalanceLamports:
      result.balance,
    solBalance:
      result.balance /
      LAMPORTS_PER_SOL,
    currentSlot: result.slot,
    rpc: rpcPool.currentLabel(),
  };

  await audit(
    'preflight.passed',
    preflight
  );

  console.log(
    [
      'Preflight passed.',
      `Cluster: ${config.expectedCluster}.`,
      `RPC: ${preflight.rpc}.`,
      `Wallet: ${preflight.wallet}.`,
      `Balance: ${preflight.solBalance.toFixed(
        6
      )} SOL.`,
    ].join(' ')
  );

  return preflight;
}
