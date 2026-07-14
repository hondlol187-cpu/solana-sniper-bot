import {
  createHash,
  randomUUID,
} from 'node:crypto';

import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';

import {
  join,
} from 'node:path';

import {
  config,
} from './config.js';

import {
  withFileLock,
} from './file-lock.js';

import {
  loadApprovedExecutionPlan,
} from './execution-plan.js';

import {
  loadExecutionJournal,
  markExecutionConfirmed,
  markSubmittedExecutionFailed,
} from './execution-journal.js';

import {
  commitReservation,
  recordTradeCompleted,
  releaseReservationIfPresent,
} from './risk.js';

import {
  auditExecutionConfirmed,
  auditExecutionFailed,
} from './execution-audit.js';

export type SettlementOutcome =
  | 'confirmed'
  | 'failed';

export type SettlementStatus =
  | 'pending'
  | 'risk-applied'
  | 'execution-applied'
  | 'committed';

export interface ExecutionSettlement {
  version: 1;

  settlementId: string;

  executionId: string;
  planId: string;
  planInstanceId: string;
  artifactId: string;
  riskReservationId: string;

  outcome:
    SettlementOutcome;

  observedSlot: number;

  confirmationStatus?:
    | 'confirmed'
    | 'finalized';

  failureReason?: string;

  status:
    SettlementStatus;

  createdAt: string;
  updatedAt: string;
  committedAt?: string;

  settlementSha256: string;
}

export interface SettleExecutionInput {
  executionId: string;

  outcome:
    SettlementOutcome;

  observedSlot: number;

  confirmationStatus?:
    | 'confirmed'
    | 'finalized';

  failureReason?: string;

  currentBalanceLamports:
    bigint;
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

function hash(
  value: string
): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

function settlementIdFor(
  executionId: string
): string {
  return hash(
    `execution-settlement-v1:${executionId}`
  ).slice(0, 32);
}

function directory():
  string {
  return join(
    config
      .approvedExecutionPlanDir,
    'execution-settlements'
  );
}

function pathFor(
  settlementId: string
): string {
  if (
    !/^[0-9a-f]{32}$/.test(
      settlementId
    )
  ) {
    throw new Error(
      'Settlement ID is invalid'
    );
  }

  return join(
    directory(),
    `${settlementId}.json`
  );
}

function computeHash(
  settlement:
    Omit<
      ExecutionSettlement,
      'settlementSha256'
    >
): string {
  return hash(
    stableStringify(
      settlement
    )
  );
}

function seal(
  settlement:
    Omit<
      ExecutionSettlement,
      'settlementSha256'
    >
): ExecutionSettlement {
  return {
    ...settlement,

    settlementSha256:
      computeHash(
        settlement
      ),
  };
}

function validate(
  settlement:
    ExecutionSettlement
): void {
  if (
    settlement.version !== 1
  ) {
    throw new Error(
      'Unsupported execution settlement version'
    );
  }

  if (
    settlement.settlementId !==
    settlementIdFor(
      settlement.executionId
    )
  ) {
    throw new Error(
      'Settlement ID does not match execution ID'
    );
  }

  if (
    !Number.isSafeInteger(
      settlement.observedSlot
    ) ||
    settlement.observedSlot < 0
  ) {
    throw new Error(
      'Settlement observed slot is invalid'
    );
  }

  if (
    settlement.outcome ===
    'confirmed'
  ) {
    if (
      settlement
        .confirmationStatus !==
        'confirmed' &&
      settlement
        .confirmationStatus !==
        'finalized'
    ) {
      throw new Error(
        'Confirmed settlement has invalid confirmation status'
      );
    }

    if (
      settlement.failureReason !==
      undefined
    ) {
      throw new Error(
        'Confirmed settlement must not have a failure reason'
      );
    }
  }

  if (
    settlement.outcome ===
    'failed'
  ) {
    if (
      !settlement
        .failureReason
        ?.trim()
    ) {
      throw new Error(
        'Failed settlement has no failure reason'
      );
    }

    if (
      settlement
        .confirmationStatus !==
      undefined
    ) {
      throw new Error(
        'Failed settlement must not have a confirmation status'
      );
    }
  }

  const {
    settlementSha256,
    ...withoutHash
  } = settlement;

  if (
    settlementSha256 !==
    computeHash(
      withoutHash
    )
  ) {
    throw new Error(
      'Execution settlement hash mismatch'
    );
  }
}

async function writeSettlement(
  settlement:
    Omit<
      ExecutionSettlement,
      'settlementSha256'
    >
): Promise<
  ExecutionSettlement
> {
  const sealed =
    seal(settlement);

  validate(sealed);

  await mkdir(
    directory(),
    {
      recursive: true,
      mode: 0o700,
    }
  );

  const path =
    pathFor(
      sealed.settlementId
    );

  const temporaryPath =
    `${path}.${randomUUID()}.tmp`;

  try {
    await writeFile(
      temporaryPath,
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
      temporaryPath,
      path
    );

    await chmod(
      path,
      0o600
    );
  } catch (error) {
    await rm(
      temporaryPath,
      {
        force: true,
      }
    );

    throw error;
  }

  return sealed;
}

export async function loadExecutionSettlement(
  settlementId: string
): Promise<
  ExecutionSettlement |
  null
> {
  const path =
    pathFor(
      settlementId
    );

  try {
    const info =
      await lstat(path);

    if (
      info.isSymbolicLink()
    ) {
      throw new Error(
        'Execution settlement path is a symbolic link'
      );
    }

    if (!info.isFile()) {
      throw new Error(
        'Execution settlement path is not a regular file'
      );
    }

    const parsed =
      JSON.parse(
        await readFile(
          path,
          'utf8'
        )
      ) as ExecutionSettlement;

    validate(parsed);

    if (
      parsed.settlementId !==
      settlementId
    ) {
      throw new Error(
        'Settlement ID does not match file name'
      );
    }

    return parsed;
  } catch (error) {
    if (
      (
        error as {
          code?: string;
        }
      ).code === 'ENOENT'
    ) {
      return null;
    }

    throw error;
  }
}

async function beginSettlement(
  input:
    SettleExecutionInput
): Promise<
  ExecutionSettlement
> {
  const execution =
    await loadExecutionJournal(
      input.executionId
    );

  if (!execution) {
    throw new Error(
      'Execution journal does not exist'
    );
  }

  if (
    execution.status !==
      'broadcasting' &&
    execution.status !==
      'submitted' &&
    execution.status !==
      'confirmed' &&
    execution.status !==
      'failed'
  ) {
    throw new Error(
      `Execution cannot be settled from ${execution.status}`
    );
  }

  if (
    !execution
      .riskReservationId
  ) {
    throw new Error(
      'Execution has no risk reservation ID'
    );
  }

  const settlementId =
    settlementIdFor(
      execution.executionId
    );

  const path =
    pathFor(
      settlementId
    );

  await mkdir(
    directory(),
    {
      recursive: true,
      mode: 0o700,
    }
  );

  return withFileLock(
    path,
    async () => {
      const existing =
        await loadExecutionSettlement(
          settlementId
        );

      if (existing) {
        if (
          existing.outcome !==
            input.outcome ||
          existing.observedSlot !==
            input.observedSlot
        ) {
          throw new Error(
            'Conflicting execution settlement already exists'
          );
        }

        return existing;
      }

      const now =
        new Date().toISOString();

      return writeSettlement({
        version: 1,
        settlementId,

        executionId:
          execution.executionId,

        planId:
          execution.planId,

        planInstanceId:
          execution.planInstanceId,

        artifactId:
          execution.artifactId,

        riskReservationId:
          execution
            .riskReservationId!,

        outcome:
          input.outcome,

        observedSlot:
          input.observedSlot,

        confirmationStatus:
          input
            .confirmationStatus,

        failureReason:
          input.failureReason,

        status: 'pending',

        createdAt: now,
        updatedAt: now,
      });
    }
  );
}

async function advance(
  settlement:
    ExecutionSettlement,
  status:
    SettlementStatus
): Promise<
  ExecutionSettlement
> {
  const path =
    pathFor(
      settlement.settlementId
    );

  return withFileLock(
    path,
    async () => {
      const current =
        await loadExecutionSettlement(
          settlement.settlementId
        );

      if (!current) {
        throw new Error(
          'Execution settlement disappeared'
        );
      }

      const {
        settlementSha256: _,
        ...withoutHash
      } = current;

      const now =
        new Date().toISOString();

      return writeSettlement({
        ...withoutHash,
        status,
        updatedAt: now,

        ...(status ===
        'committed'
          ? {
              committedAt: now,
            }
          : {}),
      });
    }
  );
}

export async function settleExecutionOutcome(
  input:
    SettleExecutionInput
): Promise<
  ExecutionSettlement
> {
  let settlement =
    await beginSettlement(
      input
    );

  const plan =
    await loadApprovedExecutionPlan(
      settlement.planId
    );

  if (
    plan.planInstanceId !==
    settlement.planInstanceId
  ) {
    throw new Error(
      'Settlement plan-instance mismatch'
    );
  }

  if (
    settlement.status ===
    'pending'
  ) {
    if (
      settlement.outcome ===
      'confirmed'
    ) {
      await commitReservation(
        settlement
          .riskReservationId,
        input
          .currentBalanceLamports
      );

      await recordTradeCompleted(
        settlement.executionId,
        input
          .currentBalanceLamports
      );
    } else {
      await releaseReservationIfPresent(
        settlement
          .riskReservationId,
        plan.payload.exactMint,
        input
          .currentBalanceLamports
      );
    }

    settlement =
      await advance(
        settlement,
        'risk-applied'
      );
  }

  if (
    settlement.status ===
    'risk-applied'
  ) {
    const currentExecution =
      await loadExecutionJournal(
        settlement.executionId
      );

    if (!currentExecution) {
      throw new Error(
        'Execution journal disappeared during settlement'
      );
    }

    if (
      settlement.outcome ===
      'confirmed'
    ) {
      if (
        currentExecution.status !==
        'confirmed'
      ) {
        await markExecutionConfirmed(
          settlement.executionId,
          {
            slot:
              settlement
                .observedSlot,

            confirmationStatus:
              settlement
                .confirmationStatus!,
          }
        );
      }
    } else if (
      currentExecution.status !==
      'failed'
    ) {
      await markSubmittedExecutionFailed(
        settlement.executionId,
        settlement.failureReason!,
        settlement.observedSlot
      );
    }

    settlement =
      await advance(
        settlement,
        'execution-applied'
      );
  }

  if (
    settlement.status ===
    'execution-applied'
  ) {
    const terminalExecution =
      await loadExecutionJournal(
        settlement.executionId
      );

    if (!terminalExecution) {
      throw new Error(
        'Terminal execution journal is missing'
      );
    }

    if (
      settlement.outcome ===
      'confirmed'
    ) {
      await auditExecutionConfirmed(
        terminalExecution
      );
    } else {
      await auditExecutionFailed(
        terminalExecution
      );
    }

    settlement =
      await advance(
        settlement,
        'committed'
      );
  }

  return settlement;
}

export async function listExecutionSettlements():
  Promise<
    ExecutionSettlement[]
  > {
  let names: string[];

  try {
    names =
      await readdir(
        directory()
      );
  } catch (error) {
    if (
      (
        error as {
          code?: string;
        }
      ).code === 'ENOENT'
    ) {
      return [];
    }

    throw error;
  }

  const settlements:
    ExecutionSettlement[] = [];

  for (const name of names) {
    if (
      !name.endsWith(
        '.json'
      )
    ) {
      continue;
    }

    const settlement =
      await loadExecutionSettlement(
        name.slice(
          0,
          -'.json'.length
        )
      );

    if (settlement) {
      settlements.push(
        settlement
      );
    }
  }

  return settlements;
}
