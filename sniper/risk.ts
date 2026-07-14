import { randomUUID } from 'node:crypto';

import {
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
  version: 1;
  utcDate: string;

  openingBalanceLamports: string;
  spentLamports: string;

  completedTrades: number;

  reservations: RiskReservation[];

  committedReservationIds: string[];
  completedTradeIds: string[];

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

function emptyState(
  openingBalanceLamports: bigint
): RiskState {
  const now =
    new Date().toISOString();

  return {
    version: 1,
    utcDate: utcDate(),

    openingBalanceLamports:
      openingBalanceLamports.toString(),

    spentLamports: '0',

    completedTrades: 0,

    reservations: [],

    committedReservationIds: [],
    completedTradeIds: [],

    updatedAt: now,
  };
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
    value as Partial<RiskState>;

  if (
    candidate.version !== 1 ||
    typeof candidate.utcDate !==
      'string' ||
    typeof candidate
      .openingBalanceLamports !==
      'string' ||
    typeof candidate.spentLamports !==
      'string' ||
    typeof candidate.completedTrades !==
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
    )
  ) {
    throw new Error(
      'Risk state has an unsupported format'
    );
  }

  validateIntegerString(
    candidate.openingBalanceLamports,
    'openingBalanceLamports'
  );

  validateIntegerString(
    candidate.spentLamports,
    'spentLamports'
  );

  return candidate as RiskState;
}

async function loadUnsafe(
  currentBalanceLamports: bigint
): Promise<RiskState> {
  try {
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
  state.updatedAt =
    new Date().toISOString();

  const temporaryFile =
    `${config.riskFile}.tmp`;

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
    config.riskFile
  );
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
