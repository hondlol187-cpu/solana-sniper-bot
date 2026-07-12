import { Connection } from '@solana/web3.js';

import {
  RaydiumPoolSignal,
} from './monitor.js';

import {
  ValidatedRaydiumPool,
  validateDecodedRaydiumPool,
} from './pool-validator.js';

import {
  decodeRaydiumInitialize2,
} from './raydium-decoder.js';

import {
  acceptPoolForTrading,
} from './candidate-gate.js';

import { audit } from './audit.js';

export async function processRaydiumSignal(
  connection: Connection,
  signal: RaydiumPoolSignal
): Promise<ValidatedRaydiumPool | null> {
  try {
    const decoded =
      await decodeRaydiumInitialize2(
        connection,
        signal
      );

    const validated =
      await validateDecodedRaydiumPool(
        connection,
        decoded
      );

    return await acceptPoolForTrading(
      validated
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.warn(
      `Raydium candidate rejected: ${message}`
    );

    await audit(
      'pool.pipeline.rejected',
      {
        signature:
          signal.signature,
        slot:
          signal.slot,
        message,
      }
    );

    return null;
  }
}
