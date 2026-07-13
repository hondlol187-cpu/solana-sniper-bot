import {
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';

import { config } from './config.js';

export interface PendingBuyState {
  version: 2;
  status: 'pending-buy';

  mint: string;

  /*
   * Token balance that existed before the buy.
   * The bot must never sell below this baseline.
   */
  balanceBeforeRaw: string;

  entryLamports: string;
  createdAt: string;

  riskReservationId?: string;
}

export interface OpenPositionState {
  version: 2;
  status: 'open';

  mint: string;

  /*
   * Original wallet balance before this bot's buy.
   */
  balanceBeforeRaw: string;

  /*
   * Total amount received from the purchase.
   */
  purchasedAmountRaw: string;

  /*
   * Amount from this purchase that the bot still
   * considers open.
   */
  remainingAmountRaw: string;

  entryLamports: string;
  buySignature: string;
  createdAt: string;
  updatedAt: string;

  riskReservationId?: string;
}

export type BotState =
  | PendingBuyState
  | OpenPositionState;

function requiredString(
  candidate: Record<string, unknown>,
  property: string
): string {
  const value = candidate[property];

  if (
    typeof value !== 'string' ||
    value.length === 0
  ) {
    throw new Error(
      `State property ${property} is missing`
    );
  }

  return value;
}

function validateIntegerString(
  value: string,
  property: string
): void {
  try {
    const parsed = BigInt(value);

    if (parsed < 0n) {
      throw new Error();
    }
  } catch {
    throw new Error(
      `State property ${property} is not a non-negative integer`
    );
  }
}

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

  /*
   * Version 1 open states do not contain the
   * original token baseline. Guessing could cause
   * pre-existing holdings to be sold.
   */
  if (candidate.version !== 2) {
    throw new Error(
      [
        'Incompatible position state version.',
        'Do not delete the state file until you have manually checked the wallet.',
        'Version 1 cannot safely distinguish purchased tokens from pre-existing holdings.',
      ].join(' ')
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

  const mint = requiredString(
    candidate,
    'mint'
  );

  const balanceBeforeRaw =
    requiredString(
      candidate,
      'balanceBeforeRaw'
    );

  const entryLamports =
    requiredString(
      candidate,
      'entryLamports'
    );

  const createdAt = requiredString(
    candidate,
    'createdAt'
  );

  validateIntegerString(
    balanceBeforeRaw,
    'balanceBeforeRaw'
  );

  validateIntegerString(
    entryLamports,
    'entryLamports'
  );

  if (
    Number.isNaN(
      new Date(createdAt).getTime()
    )
  ) {
    throw new Error(
      'State createdAt is invalid'
    );
  }

  if (
    candidate.status === 'pending-buy'
  ) {
    return {
      version: 2,
      status: 'pending-buy',
      mint,
      balanceBeforeRaw,
      entryLamports,
      createdAt,
      riskReservationId:
        typeof candidate.riskReservationId ===
          'string'
          ? candidate.riskReservationId
          : undefined,
    };
  }

  const purchasedAmountRaw =
    requiredString(
      candidate,
      'purchasedAmountRaw'
    );

  const remainingAmountRaw =
    requiredString(
      candidate,
      'remainingAmountRaw'
    );

  const buySignature =
    requiredString(
      candidate,
      'buySignature'
    );

  const updatedAt = requiredString(
    candidate,
      'updatedAt'
  );

  validateIntegerString(
    purchasedAmountRaw,
    'purchasedAmountRaw'
  );

  validateIntegerString(
    remainingAmountRaw,
    'remainingAmountRaw'
  );

  if (
    BigInt(remainingAmountRaw) >
    BigInt(purchasedAmountRaw)
  ) {
    throw new Error(
      'Remaining amount exceeds purchased amount'
    );
  }

  if (
    Number.isNaN(
      new Date(updatedAt).getTime()
    )
  ) {
    throw new Error(
      'State updatedAt is invalid'
    );
  }

  return {
    version: 2,
    status: 'open',
    mint,
    balanceBeforeRaw,
    purchasedAmountRaw,
    remainingAmountRaw,
    entryLamports,
    buySignature,
    createdAt,
    updatedAt,
    riskReservationId:
      typeof candidate.riskReservationId ===
        'string'
        ? candidate.riskReservationId
        : undefined,
  };
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
  /*
   * Validate before writing to avoid persisting a
   * malformed recovery file.
   */
  validateState(state);

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
