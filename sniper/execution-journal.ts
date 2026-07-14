import {
  randomUUID,
} from 'node:crypto';

import {
  chmod,
  mkdir,
  readFile,
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

export type ExecutionStatus =
  | 'ready'
  | 'signing'
  | 'submitted'
  | 'confirmed'
  | 'failed';

export interface ExecutionJournal {
  version: 1;

  executionId: string;
  planId: string;
  planInstanceId: string;
  artifactId: string;

  status: ExecutionStatus;

  createdAt: string;
  updatedAt: string;

  transactionSignature?:
    string;

  submittedAt?:
    string;

  confirmedAt?:
    string;

  failedAt?:
    string;

  failureReason?:
    string;
}

function assertId(
  value: string,
  label: string
): void {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(
      value
    )
  ) {
    throw new Error(
      `${label} is invalid`
    );
  }
}

function getDirectory():
  string {
  return join(
    config
      .approvedExecutionPlanDir,
    'execution-journals'
  );
}

function getPath(
  executionId: string
): string {
  assertId(
    executionId,
    'Execution ID'
  );

  return join(
    getDirectory(),
    `${executionId}.json`
  );
}

async function writeJournal(
  journal:
    ExecutionJournal
): Promise<void> {
  await mkdir(
    getDirectory(),
    {
      recursive: true,
      mode: 0o700,
    }
  );

  const path =
    getPath(
      journal.executionId
    );

  const temporaryPath =
    `${path}.${randomUUID()}.tmp`;

  try {
    await writeFile(
      temporaryPath,
      JSON.stringify(
        journal,
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
}

export async function loadExecutionJournal(
  executionId: string
): Promise<
  ExecutionJournal |
  null
> {
  try {
    const content =
      await readFile(
        getPath(executionId),
        'utf8'
      );

    return JSON.parse(
      content
    ) as ExecutionJournal;
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

export function buildExecutionId(
  planInstanceId: string,
  artifactId: string
): string {
  /*
   * Deterministic ID ensures retries for the same plan
   * and artifact reopen the same execution journal.
   */
  const value =
    Buffer.from(
      `${planInstanceId}:${artifactId}`
    ).toString('base64url');

  return value.slice(
    0,
    96
  );
}

export async function beginExecution(
  planId: string,
  planInstanceId: string,
  artifactId: string
): Promise<ExecutionJournal> {
  const executionId =
    buildExecutionId(
      planInstanceId,
      artifactId
    );

  const path =
    getPath(
      executionId
    );

  /*
   * Ensure the directory exists before acquiring
   * the lock, because withFileLock opens the .lock
   * file with O_EXCL which fails if the parent
   * directory does not exist.
   */
  await mkdir(
    getDirectory(),
    {
      recursive: true,
      mode: 0o700,
    }
  );

  return withFileLock(
    path,
    async () => {
      const existing =
        await loadExecutionJournal(
          executionId
        );

      if (existing) {
        if (
          existing.planId !==
            planId ||
          existing.planInstanceId !==
            planInstanceId ||
          existing.artifactId !==
            artifactId
        ) {
          throw new Error(
            'Execution journal identity mismatch'
          );
        }

        if (
          existing.status ===
            'submitted' ||
          existing.status ===
            'confirmed'
        ) {
          throw new Error(
            `Execution has already reached ${existing.status}`
          );
        }

        return existing;
      }

      const now =
        new Date().toISOString();

      const journal:
        ExecutionJournal = {
          version: 1,
          executionId,
          planId,
          planInstanceId,
          artifactId,
          status: 'ready',
          createdAt: now,
          updatedAt: now,
        };

      await writeJournal(
        journal
      );

      return journal;
    }
  );
}

async function transitionExecution(
  executionId: string,
  expected:
    ExecutionStatus[],
  update: (
    current:
      ExecutionJournal
  ) => ExecutionJournal
): Promise<ExecutionJournal> {
  const path =
    getPath(
      executionId
    );

  /*
   * Ensure the directory exists before acquiring
   * the lock (same reason as beginExecution).
   */
  await mkdir(
    getDirectory(),
    {
      recursive: true,
      mode: 0o700,
    }
  );

  return withFileLock(
    path,
    async () => {
      const current =
        await loadExecutionJournal(
          executionId
        );

      if (!current) {
        throw new Error(
          'Execution journal does not exist'
        );
      }

      if (
        !expected.includes(
          current.status
        )
      ) {
        throw new Error(
          `Invalid execution transition from ${current.status}`
        );
      }

      const next =
        update(current);

      await writeJournal(
        next
      );

      return next;
    }
  );
}

export function markExecutionSigning(
  executionId: string
) {
  return transitionExecution(
    executionId,
    ['ready'],
    (current) => ({
      ...current,
      status: 'signing',
      updatedAt:
        new Date().toISOString(),
    })
  );
}

export function markExecutionSubmitted(
  executionId: string,
  transactionSignature:
    string
) {
  if (
    !transactionSignature
      .trim()
  ) {
    throw new Error(
      'Transaction signature is required'
    );
  }

  return transitionExecution(
    executionId,
    ['signing'],
    (current) => {
      const now =
        new Date().toISOString();

      return {
        ...current,
        status: 'submitted',
        transactionSignature,
        submittedAt: now,
        updatedAt: now,
      };
    }
  );
}

export function markExecutionConfirmed(
  executionId: string
) {
  return transitionExecution(
    executionId,
    ['submitted'],
    (current) => {
      const now =
        new Date().toISOString();

      return {
        ...current,
        status: 'confirmed',
        confirmedAt: now,
        updatedAt: now,
      };
    }
  );
}

export function markExecutionFailed(
  executionId: string,
  failureReason: string
) {
  const reason =
    failureReason.trim();

  if (!reason) {
    throw new Error(
      'Execution failure reason is required'
    );
  }

  return transitionExecution(
    executionId,
    [
      'ready',
      'signing',
    ],
    (current) => {
      const now =
        new Date().toISOString();

      return {
        ...current,
        status: 'failed',
        failedAt: now,
        failureReason:
          reason.slice(0, 500),
        updatedAt: now,
      };
    }
  );
}
