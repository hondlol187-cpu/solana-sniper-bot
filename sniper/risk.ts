import {
  createHash,
  randomUUID,
} from 'node:crypto';

import {
  chmod,
  lstat,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';

import { config } from './config.js';
import {
  audit,
  auditOnce,
} from './audit.js';

import {
  withFileLock,
} from './file-lock.js';

export interface RiskReservation {
  id: string;
  mint: string;
  amountLamports: string;
  createdAt: string;
}

export interface RiskState {
  version: 2;

  utcDate: string;

  openingBalanceLamports:
    string;

  spentLamports: string;

  completedTrades: number;

  reservations:
    RiskReservation[];

  committedReservationIds:
    string[];

  completedTradeIds:
    string[];

  haltedReason?: string;

  updatedAt: string;

  /*
   * SHA-256 over every field except stateSha256.
   */
  stateSha256: string;
}

interface LegacyRiskState {
  version: 1;

  utcDate: string;

  openingBalanceLamports:
    string;

  spentLamports: string;

  completedTrades: number;

  reservations:
    RiskReservation[];

  committedReservationIds:
    string[];

  completedTradeIds:
    string[];

  haltedReason?: string;

  updatedAt: string;
}

let modificationQueue:
  Promise<void> = Promise.resolve();

function serialize<T>(
  operation: () => Promise<T>
): Promise<T> {
  const guardedOperation = () =>
    withFileLock(
      config.riskFile,
      operation
    );

  const run =
    modificationQueue.then(
      guardedOperation,
      guardedOperation
    );

  modificationQueue = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}

function utcDate(): string {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

function solToLamports(
  sol: number
): bigint {
  return BigInt(
    Math.floor(
      sol * 1_000_000_000
    )
  );
}

function stableStringify(
  value: unknown
): string {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map(stableStringify)
      .join(',')}]`;
  }

  const entries =
    Object.entries(
      value as Record<
        string,
        unknown
      >
    )
      .filter(
        ([, item]) =>
          item !== undefined
      )
      .sort(([left], [right]) =>
        left.localeCompare(right)
      );

  return `{${entries
    .map(
      ([key, item]) =>
        `${JSON.stringify(key)}:${stableStringify(item)}`
    )
    .join(',')}}`;
}

function computeRiskStateHash(
  state:
    Omit<
      RiskState,
      'stateSha256'
    >
): string {
  return createHash('sha256')
    .update(
      stableStringify(
        state
      )
    )
    .digest('hex');
}

function sealRiskState(
  state:
    Omit<
      RiskState,
      'stateSha256'
    >
): RiskState {
  return {
    ...state,

    stateSha256:
      computeRiskStateHash(
        state
      ),
  };
}

function assertIsoTimestamp(
  value: string,
  label: string
): void {
  if (
    !Number.isFinite(
      Date.parse(value)
    )
  ) {
    throw new Error(
      `${label} is invalid`
    );
  }
}

function emptyState(
  openingBalanceLamports:
    bigint
): RiskState {
  const now =
    new Date().toISOString();

  return sealRiskState({
    version: 2,

    utcDate:
      utcDate(),

    openingBalanceLamports:
      openingBalanceLamports
        .toString(),

    spentLamports: '0',

    completedTrades: 0,

    reservations: [],

    committedReservationIds:
      [],

    completedTradeIds: [],

    updatedAt: now,
  });
}

function validateIntegerString(
  value: string,
  name: string
): void {
  try {
    const parsed = BigInt(value);

    if (parsed < 0n) {
      throw new Error();
    }
  } catch {
    throw new Error(
      `Risk property ${name} is invalid`
    );
  }
}

function validateReservation(
  reservation:
    RiskReservation
): void {
  if (
    !reservation.id ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(
      reservation.id
    )
  ) {
    throw new Error(
      'Risk reservation ID is invalid'
    );
  }

  if (
    !reservation.mint.trim()
  ) {
    throw new Error(
      'Risk reservation mint is invalid'
    );
  }

  validateIntegerString(
    reservation
      .amountLamports,
    'reservation.amountLamports'
  );

  if (
    BigInt(
      reservation.amountLamports
    ) <= 0n
  ) {
    throw new Error(
      'Risk reservation amount must be positive'
    );
  }

  assertIsoTimestamp(
    reservation.createdAt,
    'Risk reservation createdAt'
  );
}

function validateRiskStateContents(
  state:
    Omit<
      RiskState,
      'stateSha256'
    >
): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      state.utcDate
    )
  ) {
    throw new Error(
      'Risk utcDate is invalid'
    );
  }

  validateIntegerString(
    state
      .openingBalanceLamports,
    'openingBalanceLamports'
  );

  validateIntegerString(
    state.spentLamports,
    'spentLamports'
  );

  if (
    !Number.isSafeInteger(
      state.completedTrades
    ) ||
    state.completedTrades < 0
  ) {
    throw new Error(
      'Risk completedTrades is invalid'
    );
  }

  assertIsoTimestamp(
    state.updatedAt,
    'Risk updatedAt'
  );

  const reservationIds =
    new Set<string>();

  for (
    const reservation of
    state.reservations
  ) {
    validateReservation(
      reservation
    );

    if (
      reservationIds.has(
        reservation.id
      )
    ) {
      throw new Error(
        `Duplicate active risk reservation: ${reservation.id}`
      );
    }

    reservationIds.add(
      reservation.id
    );
  }

  const committedIds =
    new Set(
      state
        .committedReservationIds
    );

  if (
    committedIds.size !==
    state
      .committedReservationIds
      .length
  ) {
    throw new Error(
      'Risk committedReservationIds contains duplicates'
    );
  }

  const completedIds =
    new Set(
      state.completedTradeIds
    );

  if (
    completedIds.size !==
    state.completedTradeIds
      .length
  ) {
    throw new Error(
      'Risk completedTradeIds contains duplicates'
    );
  }

  for (
    const reservationId of
    reservationIds
  ) {
    if (
      committedIds.has(
        reservationId
      )
    ) {
      throw new Error(
        `Risk reservation ${reservationId} is both active and committed`
      );
    }
  }

  if (
    state.haltedReason !==
      undefined &&
    (
      typeof state
        .haltedReason !==
        'string' ||
      !state.haltedReason.trim()
    )
  ) {
    throw new Error(
      'Risk haltedReason is invalid'
    );
  }
}

function validateState(
  value: unknown
): RiskState {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    throw new Error(
      'Risk state is not an object'
    );
  }

  const candidate =
    value as Record<
      string,
      unknown
    >;

  if (
    (
      candidate.version !== 1 &&
      candidate.version !== 2
    ) ||
    typeof candidate.utcDate !==
      'string' ||
    typeof candidate
      .openingBalanceLamports !==
      'string' ||
    typeof candidate
      .spentLamports !==
      'string' ||
    typeof candidate
      .completedTrades !==
      'number' ||
    !Array.isArray(
      candidate.reservations
    ) ||
    !Array.isArray(
      candidate
        .committedReservationIds
    ) ||
    !Array.isArray(
      candidate.completedTradeIds
    ) ||
    typeof candidate.updatedAt !==
      'string'
  ) {
    throw new Error(
      'Risk state has an unsupported format'
    );
  }

  const body:
    Omit<
      RiskState,
      'stateSha256'
    > = {
      version: 2,

      utcDate:
        candidate.utcDate as
          string,

      openingBalanceLamports:
        candidate
          .openingBalanceLamports as
          string,

      spentLamports:
        candidate
          .spentLamports as
          string,

      completedTrades:
        candidate
          .completedTrades as
          number,

      reservations:
        candidate
          .reservations as
          RiskReservation[],

      committedReservationIds:
        candidate
          .committedReservationIds as
          string[],

      completedTradeIds:
        candidate
          .completedTradeIds as
          string[],

      updatedAt:
        candidate
          .updatedAt as
          string,

      ...(candidate
        .haltedReason !==
        undefined
        ? {
            haltedReason:
              candidate
                .haltedReason as
                string,
          }
        : {}),
    };

  validateRiskStateContents(
    body
  );

  /*
   * Version 1 is accepted for one-way migration. Its
   * historical integrity cannot be proven, but the next
   * write upgrades it to a hashed v2 state.
   */
  if (
    candidate.version === 1
  ) {
    return sealRiskState(
      body
    );
  }

  const candidateStateSha256 =
    candidate
      .stateSha256;

  if (
    typeof candidateStateSha256 !==
      'string' ||
    !/^[0-9a-f]{64}$/.test(
      candidateStateSha256
    )
  ) {
    throw new Error(
      'Risk state SHA-256 is invalid'
    );
  }

  const expectedHash =
    computeRiskStateHash(
      body
    );

  if (
    candidateStateSha256 !==
    expectedHash
  ) {
    throw new Error(
      'Risk state hash mismatch'
    );
  }

  return {
    ...body,

    stateSha256:
      candidateStateSha256,
  };
}

async function loadUnsafe(
  currentBalanceLamports: bigint
): Promise<RiskState> {
  try {
    const info =
      await lstat(
        config.riskFile
      );

    if (
      info.isSymbolicLink()
    ) {
      throw new Error(
        'Risk state file must not be a symbolic link'
      );
    }

    if (!info.isFile()) {
      throw new Error(
        'Risk state path is not a regular file'
      );
    }

    if (
      process.platform !==
        'win32' &&
      (
        info.mode &
        0o077
      ) !== 0
    ) {
      throw new Error(
        'Risk state file permissions are too open'
      );
    }

    const content = await readFile(
      config.riskFile,
      'utf8'
    );

    const state = validateState(
      JSON.parse(content)
    );

    if (
      state.utcDate !== utcDate()
    ) {
      /*
       * Never discard an unresolved reservation at
       * midnight. It could represent a transaction
       * whose confirmation was interrupted.
       */
      if (
        state.reservations.length > 0
      ) {
        throw new Error(
          [
            'Risk ledger contains reservations from a previous UTC day.',
            'Review them manually before continuing.',
          ].join(' ')
        );
      }

      return emptyState(
        currentBalanceLamports
      );
    }

    return state;
  } catch (error) {
    const code = (
      error as NodeJS.ErrnoException
    ).code;

    if (code === 'ENOENT') {
      return emptyState(
        currentBalanceLamports
      );
    }

    throw error;
  }
}

async function saveUnsafe(
  state: RiskState
): Promise<void> {
  const {
    stateSha256: _,
    ...existingBody
  } = state;

  const body:
    Omit<
      RiskState,
      'stateSha256'
    > = {
      ...existingBody,

      version: 2,

      updatedAt:
        new Date()
          .toISOString(),
    };

  validateRiskStateContents(
    body
  );

  const sealed =
    sealRiskState(
      body
    );

  const temporaryFile =
    `${config.riskFile}.${randomUUID()}.tmp`;

  try {
    await writeFile(
      temporaryFile,
      JSON.stringify(
        sealed,
        null,
        2
      ),
      {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      }
    );

    await rename(
      temporaryFile,
      config.riskFile
    );

    await chmod(
      config.riskFile,
      0o600
    );

    Object.assign(
      state,
      sealed
    );
  } catch (error) {
    try {
      await unlink(
        temporaryFile
      );
    } catch {
      // Best-effort temporary-file cleanup.
    }

    throw error;
  }
}

function reservedTotal(
  state: RiskState
): bigint {
  return state.reservations.reduce(
    (total, reservation) =>
      total +
      BigInt(
        reservation.amountLamports
      ),
    0n
  );
}

function validateReservationId(
  reservationId: string
): void {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(
      reservationId
    )
  ) {
    throw new Error(
      'Risk reservation ID is invalid'
    );
  }
}

async function reserveTradeWithId(
  reservationId: string,
  mint: string,
  amountLamports: bigint,
  currentBalanceLamports: bigint
): Promise<RiskReservation> {
  validateReservationId(
    reservationId
  );

  if (
    amountLamports <= 0n
  ) {
    throw new Error(
      'Risk reservation amount must be positive'
    );
  }

  if (!mint.trim()) {
    throw new Error(
      'Risk reservation mint is required'
    );
  }

  return serialize(
    async () => {
      const state =
        await loadUnsafe(
          currentBalanceLamports
        );

      const existing =
        state.reservations.find(
          (reservation) =>
            reservation.id ===
            reservationId
        );

      if (existing) {
        if (
          existing.mint !== mint ||
          existing
            .amountLamports !==
            amountLamports.toString()
        ) {
          throw new Error(
            'Existing risk reservation does not match requested trade'
          );
        }

        return existing;
      }

      if (
        state
          .committedReservationIds
          .includes(
            reservationId
          )
      ) {
        throw new Error(
          'Risk reservation has already been committed'
        );
      }

      if (state.haltedReason) {
        throw new Error(
          `Risk circuit breaker is halted: ${state.haltedReason}`
        );
      }

      const openingBalance =
        BigInt(
          state
            .openingBalanceLamports
        );

      const drawdown =
        openingBalance >
        currentBalanceLamports
          ? openingBalance -
            currentBalanceLamports
          : 0n;

      const maximumDrawdown =
        solToLamports(
          config
            .maxDailyDrawdownSol
        );

      if (
        drawdown >
        maximumDrawdown
      ) {
        state.haltedReason =
          `Daily drawdown exceeded: ${drawdown} lamports`;

        await saveUnsafe(
          state
        );

        throw new Error(
          state.haltedReason
        );
      }

      const spent =
        BigInt(
          state.spentLamports
        );

      const projectedSpend =
        spent +
        reservedTotal(state) +
        amountLamports;

      const maximumSpend =
        solToLamports(
          config.maxDailySpendSol
        );

      if (
        projectedSpend >
        maximumSpend
      ) {
        state.haltedReason =
          `Daily spend limit exceeded: projected ${projectedSpend}, maximum ${maximumSpend}`;

        await saveUnsafe(
          state
        );

        throw new Error(
          state.haltedReason
        );
      }

      const projectedTradeCount =
        state.completedTrades +
        state.reservations.length +
        1;

      if (
        projectedTradeCount >
        config.maxDailyTrades
      ) {
        state.haltedReason =
          `Daily trade limit exceeded: ${projectedTradeCount}/${config.maxDailyTrades}`;

        await saveUnsafe(
          state
        );

        throw new Error(
          state.haltedReason
        );
      }

      const reservation:
        RiskReservation = {
          id: reservationId,
          mint,
          amountLamports:
            amountLamports
              .toString(),
          createdAt:
            new Date()
              .toISOString(),
        };

      state.reservations.push(
        reservation
      );

      await saveUnsafe(
        state
      );

      await auditOnce(
        'risk.trade.reserved',
        `risk-reserved:${reservationId}`,
        {
          reservationId,
          mint,
          amountLamports:
            amountLamports
              .toString(),
          projectedSpend:
            projectedSpend
              .toString(),
          projectedTradeCount,
        }
      );

      return reservation;
    }
  );
}

export function reserveTrade(
  mint: string,
  amountLamports: bigint,
  currentBalanceLamports: bigint
) {
  return reserveTradeWithId(
    randomUUID(),
    mint,
    amountLamports,
    currentBalanceLamports
  );
}

export function reserveTradeOnce(
  reservationId: string,
  mint: string,
  amountLamports: bigint,
  currentBalanceLamports: bigint
) {
  return reserveTradeWithId(
    reservationId,
    mint,
    amountLamports,
    currentBalanceLamports
  );
}

export async function commitReservation(
  reservationId: string,
  currentBalanceLamports: bigint
): Promise<void> {
  return serialize(async () => {
    const state = await loadUnsafe(
      currentBalanceLamports
    );

    if (
      state.committedReservationIds.includes(
        reservationId
      )
    ) {
      return;
    }

    const index =
      state.reservations.findIndex(
        (reservation) =>
          reservation.id ===
          reservationId
      );

    if (index < 0) {
      throw new Error(
        `Risk reservation ${reservationId} was not found`
      );
    }

    const [reservation] =
      state.reservations.splice(
        index,
        1
      );

    state.spentLamports = (
      BigInt(state.spentLamports) +
      BigInt(
        reservation.amountLamports
      )
    ).toString();

    state.committedReservationIds.push(
      reservationId
    );

    state.committedReservationIds =
      state.committedReservationIds.slice(
        -1_000
      );

    await saveUnsafe(state);

    await audit(
      'risk.trade.committed',
      {
        reservationId,
        mint:
          reservation.mint,
        amountLamports:
          reservation.amountLamports,
      }
    );
  });
}

export async function recordTradeCompleted(
  tradeId: string,
  currentBalanceLamports: bigint
): Promise<void> {
  return serialize(async () => {
    const state = await loadUnsafe(
      currentBalanceLamports
    );

    if (
      state.completedTradeIds.includes(
        tradeId
      )
    ) {
      return;
    }

    state.completedTrades += 1;
    state.completedTradeIds.push(
      tradeId
    );

    state.completedTradeIds =
      state.completedTradeIds.slice(
        -1_000
      );

    await saveUnsafe(state);

    await audit(
      'risk.trade.completed',
      {
        tradeId,
        completedTrades:
          state.completedTrades,
      }
    );
  });
}

export async function releaseReservation(
  reservationId: string,
  expectedMint: string,
  currentBalanceLamports: bigint
): Promise<void> {
  return serialize(async () => {
    const state = await loadUnsafe(
      currentBalanceLamports
    );

    const index =
      state.reservations.findIndex(
        (reservation) =>
          reservation.id ===
          reservationId
      );

    if (index < 0) {
      throw new Error(
        'Risk reservation was not found'
      );
    }

    const reservation =
      state.reservations[index];

    if (
      reservation.mint !==
      expectedMint
    ) {
      throw new Error(
        'Reservation mint confirmation does not match'
      );
    }

    state.reservations.splice(
      index,
      1
    );

    await saveUnsafe(state);

    await audit(
      'risk.reservation.released',
      {
        reservationId,
        expectedMint,
      }
    );
  });
}

export async function getRiskState(
  currentBalanceLamports: bigint
): Promise<RiskState> {
  return serialize(() =>
    loadUnsafe(
      currentBalanceLamports
    )
  );
}

export async function releaseReservationIfPresent(
  reservationId: string,
  expectedMint: string,
  currentBalanceLamports: bigint
): Promise<{
  released: boolean;
}> {
  validateReservationId(
    reservationId
  );

  return serialize(
    async () => {
      const state =
        await loadUnsafe(
          currentBalanceLamports
        );

      const index =
        state.reservations
          .findIndex(
            (reservation) =>
              reservation.id ===
              reservationId
          );

      if (index < 0) {
        if (
          state
            .committedReservationIds
            .includes(
              reservationId
            )
        ) {
          throw new Error(
            'Cannot release a committed risk reservation'
          );
        }

        return {
          released: false,
        };
      }

      const reservation =
        state.reservations[
          index
        ];

      if (
        reservation.mint !==
        expectedMint
      ) {
        throw new Error(
          'Reservation mint confirmation does not match'
        );
      }

      state.reservations.splice(
        index,
        1
      );

      await saveUnsafe(
        state
      );

      await auditOnce(
        'risk.reservation.released',
        `risk-released:${reservationId}`,
        {
          reservationId,
          expectedMint,
        }
      );

      return {
        released: true,
      };
    }
  );
}

export async function resetRiskState(
  currentBalanceLamports: bigint
): Promise<void> {
  return serialize(async () => {
    const current = await loadUnsafe(
      currentBalanceLamports
    );

    if (
      current.reservations.length > 0
    ) {
      throw new Error(
        'Cannot reset risk state while reservations exist'
      );
    }

    await saveUnsafe(
      emptyState(
        currentBalanceLamports
      )
    );

    await audit(
      'risk.state.reset',
      {
        currentBalanceLamports:
          currentBalanceLamports.toString(),
      }
    );
  });
}

export async function deleteRiskFileForTests(): Promise<void> {
  return serialize(async () => {
    try {
      await unlink(config.riskFile);
    } catch (error) {
      const code = (
        error as NodeJS.ErrnoException
      ).code;

      if (code !== 'ENOENT') {
        throw error;
      }
    }
  });
}
