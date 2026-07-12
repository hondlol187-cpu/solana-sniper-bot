import {
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';

import { config } from './config.js';

export interface PendingBuyState {
  version: 1;
  status: 'pending-buy';
  mint: string;
  balanceBeforeRaw: string;
  entryLamports: string;
  createdAt: string;
}

export interface OpenPositionState {
  version: 1;
  status: 'open';
  mint: string;
  purchasedAmountRaw: string;
  entryLamports: string;
  buySignature: string;
  createdAt: string;
}

export type BotState =
  | PendingBuyState
  | OpenPositionState;

function validateState(
  value: unknown
): BotState {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    throw new Error(
      'Position state is not an object'
    );
  }

  const candidate =
    value as Record<string, unknown>;

  if (candidate.version !== 1) {
    throw new Error(
      'Unsupported position state version'
    );
  }

  if (
    candidate.status !== 'pending-buy' &&
    candidate.status !== 'open'
  ) {
    throw new Error(
      'Invalid position state status'
    );
  }

  if (
    typeof candidate.mint !== 'string' ||
    typeof candidate.entryLamports !==
      'string' ||
    typeof candidate.createdAt !==
      'string'
  ) {
    throw new Error(
      'Position state is missing required fields'
    );
  }

  if (
    candidate.status === 'pending-buy'
  ) {
    if (
      typeof candidate.balanceBeforeRaw !==
      'string'
    ) {
      throw new Error(
        'Pending position is missing balanceBeforeRaw'
      );
    }
  }

  if (candidate.status === 'open') {
    if (
      typeof candidate.purchasedAmountRaw !==
        'string' ||
      typeof candidate.buySignature !==
        'string'
    ) {
      throw new Error(
        'Open position is missing required fields'
      );
    }
  }

  return candidate as unknown as BotState;
}

export async function loadState(): Promise<
  BotState | null
> {
  try {
    const content = await readFile(
      config.stateFile,
      'utf8'
    );

    return validateState(
      JSON.parse(content)
    );
  } catch (error) {
    const code = (
      error as NodeJS.ErrnoException
    ).code;

    if (code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function saveState(
  state: BotState
): Promise<void> {
  const temporaryFile =
    `${config.stateFile}.tmp`;

  await writeFile(
    temporaryFile,
    JSON.stringify(state, null, 2),
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );

  await rename(
    temporaryFile,
    config.stateFile
  );
}

export async function clearState(): Promise<void> {
  try {
    await unlink(config.stateFile);
  } catch (error) {
    const code = (
      error as NodeJS.ErrnoException
    ).code;

    if (code !== 'ENOENT') {
      throw error;
    }
  }
}
