import {
  Connection,
  PublicKey,
} from '@solana/web3.js';

import { audit } from './audit.js';

export const RAYDIUM_AMM_V4 =
  new PublicKey(
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'
  );

export interface RaydiumPoolSignal {
  signature: string;
  slot: number;
  programId: string;
  detectedAt: string;

  /*
   * A signal is not a decoded or validated pool.
   * It must never trigger a purchase directly.
   */
  validated: false;
}

export interface MonitorOptions {
  maximumRememberedSignatures?: number;
}

/*
 * This monitor only reports transaction signatures
 * that appear related to Raydium initialization.
 *
 * It intentionally does not guess account indexes,
 * mint addresses, vault addresses or liquidity.
 */
export function startRaydiumSignalMonitor(
  connection: Connection,
  onSignal: (
    signal: RaydiumPoolSignal
  ) => void | Promise<void>,
  options: MonitorOptions = {}
): () => void {
  const maximumRemembered =
    options.maximumRememberedSignatures ??
    10_000;

  const seen = new Set<string>();
  const order: string[] = [];

  function remember(
    signature: string
  ): boolean {
    if (seen.has(signature)) {
      return false;
    }

    seen.add(signature);
    order.push(signature);

    while (
      order.length >
      maximumRemembered
    ) {
      const oldest = order.shift();

      if (oldest) {
        seen.delete(oldest);
      }
    }

    return true;
  }

  console.log(
    'Starting Raydium signal-only monitor'
  );

  const subscriptionId =
    connection.onLogs(
      RAYDIUM_AMM_V4,
      async (logs, context) => {
        if (logs.err) return;

        const appearsToInitialize =
          logs.logs.some((line) => {
            const normalized =
              line.toLowerCase();

            return (
              normalized.includes(
                'initialize2'
              ) ||
              normalized.includes(
                'initialize'
              )
            );
          });

        if (!appearsToInitialize) {
          return;
        }

        if (
          !remember(logs.signature)
        ) {
          return;
        }

        const signal: RaydiumPoolSignal = {
          signature: logs.signature,
          slot: context.slot,
          programId:
            RAYDIUM_AMM_V4.toBase58(),
          detectedAt:
            new Date().toISOString(),
          validated: false,
        };

        await audit(
          'pool.signal.detected',
          {
            signature:
              signal.signature,
            slot: signal.slot,
            programId:
              signal.programId,
          }
        );

        try {
          await onSignal(signal);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : String(error);

          console.error(
            `Pool signal callback failed: ${message}`
          );

          await audit(
            'pool.signal.callback.failed',
            {
              signature:
                signal.signature,
              message,
            }
          );
        }
      },
      'confirmed'
    );

  return () => {
    void connection
      .removeOnLogsListener(
        subscriptionId
      )
      .catch((error: unknown) => {
        console.error(
          'Failed to remove Raydium log subscription:',
          error
        );
      });
  };
}
