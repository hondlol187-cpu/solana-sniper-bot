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

export type ExecutionStatus =
  | 'ready'
  | 'signing'
  | 'broadcasting'
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

  transactionSignature?: string;
  signedTransactionSha256?: string;
  transactionMessageSha256?: string;
  lastValidBlockHeight?: number;
  broadcastPreparedAt?: string;

  submittedAt?: string;
  confirmedAt?: string;
  failedAt?: string;
  failureReason?: string;

  /*
   * SHA-256 over every field except journalSha256.
   */
  journalSha256: string;
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

function getDirectory(): string {
  return join(
    config.approvedExecutionPlanDir,
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

function stableStringify(
  value: unknown
): string {
  if (value === undefined) {
    return 'null';
  }

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
      value as Record<string, unknown>
    )
    .filter(
      ([, item]) => item !== undefined
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

function computeJournalHash(
  journal: Omit<ExecutionJournal, 'journalSha256'>
): string {
  return createHash('sha256')
    .update(stableStringify(journal))
    .digest('hex');
}

function sealJournal(
  journal: Omit<ExecutionJournal, 'journalSha256'>
): ExecutionJournal {
  return {
    ...journal,
    journalSha256: computeJournalHash(journal),
  };
}

function assertIsoTimestamp(
  value: string,
  label: string
): void {
  const milliseconds = Date.parse(value);

  if (!Number.isFinite(milliseconds)) {
    throw new Error(
      `${label} is invalid`
    );
  }
}

function validateJournal(
  journal: ExecutionJournal
): void {
  if (journal.version !== 1) {
    throw new Error(
      `Unsupported execution journal version: ${String(journal.version)}`
    );
  }

  assertId(journal.executionId, 'Execution ID');
  assertId(journal.planId, 'Plan ID');
  assertId(journal.artifactId, 'Artifact ID');

  if (!journal.planInstanceId.trim()) {
    throw new Error(
      'Execution journal planInstanceId is missing'
    );
  }

  const validStatuses = new Set<ExecutionStatus>([
    'ready',
    'signing',
    'broadcasting',
    'submitted',
    'confirmed',
    'failed',
  ]);

  if (!validStatuses.has(journal.status)) {
    throw new Error(
      `Invalid execution journal status: ${String(journal.status)}`
    );
  }

  assertIsoTimestamp(journal.createdAt, 'Execution createdAt');
  assertIsoTimestamp(journal.updatedAt, 'Execution updatedAt');

  if (
    Date.parse(journal.updatedAt) <
    Date.parse(journal.createdAt)
  ) {
    throw new Error(
      'Execution updatedAt is before createdAt'
    );
  }

  if (
    journal.status ===
      'broadcasting' ||
    journal.status ===
      'submitted' ||
    journal.status ===
      'confirmed'
  ) {
    if (
      !journal
        .transactionSignature
        ?.trim()
    ) {
      throw new Error(
        `${journal.status} execution has no transaction signature`
      );
    }

    if (
      !/^[0-9a-f]{64}$/.test(
        journal
          .signedTransactionSha256 ??
        ''
      )
    ) {
      throw new Error(
        `${journal.status} execution has invalid signed transaction hash`
      );
    }

    if (
      !/^[0-9a-f]{64}$/.test(
        journal
          .transactionMessageSha256 ??
        ''
      )
    ) {
      throw new Error(
        `${journal.status} execution has invalid message hash`
      );
    }

    if (
      !Number.isSafeInteger(
        journal.lastValidBlockHeight
      ) ||
      (
        journal.lastValidBlockHeight ??
        -1
      ) < 0
    ) {
      throw new Error(
        `${journal.status} execution has invalid lastValidBlockHeight`
      );
    }

    if (
      !journal.broadcastPreparedAt
    ) {
      throw new Error(
        `${journal.status} execution has no broadcastPreparedAt`
      );
    }

    assertIsoTimestamp(
      journal.broadcastPreparedAt,
      'Execution broadcastPreparedAt'
    );
  }

  if (
    journal.status === 'submitted' ||
    journal.status === 'confirmed'
  ) {
    if (!journal.submittedAt) {
      throw new Error(
        `${journal.status} execution has no submittedAt`
      );
    }

    assertIsoTimestamp(journal.submittedAt, 'Execution submittedAt');
  }

  if (journal.status === 'confirmed') {
    if (!journal.confirmedAt) {
      throw new Error(
        'Confirmed execution has no confirmedAt'
      );
    }

    assertIsoTimestamp(journal.confirmedAt, 'Execution confirmedAt');
  }

  if (journal.status === 'failed') {
    if (!journal.failureReason?.trim()) {
      throw new Error(
        'Failed execution has no failureReason'
      );
    }

    if (!journal.failedAt) {
      throw new Error(
        'Failed execution has no failedAt'
      );
    }

    assertIsoTimestamp(journal.failedAt, 'Execution failedAt');
  }

  if (!/^[0-9a-f]{64}$/.test(journal.journalSha256)) {
    throw new Error(
      'Execution journal SHA-256 is invalid'
    );
  }

  const { journalSha256, ...withoutHash } = journal;
  const expectedHash = computeJournalHash(withoutHash);

  if (journalSha256 !== expectedHash) {
    throw new Error(
      'Execution journal hash mismatch'
    );
  }

  const expectedExecutionId = buildExecutionId(
    journal.planInstanceId,
    journal.artifactId
  );

  if (journal.executionId !== expectedExecutionId) {
    throw new Error(
      'Execution journal ID does not match plan and artifact identity'
    );
  }
}

async function writeJournal(
  journal: Omit<ExecutionJournal, 'journalSha256'>
): Promise<ExecutionJournal> {
  const sealed = sealJournal(journal);

  validateJournal(sealed);

  await mkdir(getDirectory(), {
    recursive: true,
    mode: 0o700,
  });

  const path = getPath(sealed.executionId);

  const temporaryPath = `${path}.${randomUUID()}.tmp`;

  try {
    await writeFile(
      temporaryPath,
      JSON.stringify(sealed, null, 2),
      {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      }
    );

    await rename(temporaryPath, path);

    await chmod(path, 0o600);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }

  return sealed;
}

export async function loadExecutionJournal(
  executionId: string
): Promise<ExecutionJournal | null> {
  const path = getPath(executionId);

  try {
    const stats = await lstat(path);

    if (stats.isSymbolicLink()) {
      throw new Error(
        'Execution journal path is a symbolic link'
      );
    }

    if (!stats.isFile()) {
      throw new Error(
        'Execution journal path is not a regular file'
      );
    }

    const content = await readFile(path, 'utf8');

    let journal: ExecutionJournal;

    try {
      journal = JSON.parse(content) as ExecutionJournal;
    } catch {
      throw new Error(
        'Execution journal contains invalid JSON'
      );
    }

    validateJournal(journal);

    if (journal.executionId !== executionId) {
      throw new Error(
        'Execution journal ID does not match file name'
      );
    }

    return journal;
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export function buildExecutionId(
  planInstanceId: string,
  artifactId: string
): string {
  if (!planInstanceId.trim()) {
    throw new Error(
      'Plan instance ID is required'
    );
  }

  assertId(artifactId, 'Artifact ID');

  return createHash('sha256')
    .update(
      [
        'execution-journal-v1',
        planInstanceId,
        artifactId,
      ].join(':')
    )
    .digest('hex')
    .slice(0, 32);
}

export async function beginExecution(
  planId: string,
  planInstanceId: string,
  artifactId: string
): Promise<ExecutionJournal> {
  const executionId = buildExecutionId(
    planInstanceId,
    artifactId
  );

  const path = getPath(executionId);

  await mkdir(getDirectory(), {
    recursive: true,
    mode: 0o700,
  });

  return withFileLock(
    path,
    async () => {
      const existing = await loadExecutionJournal(executionId);

      if (existing) {
        if (
          existing.planId !== planId ||
          existing.planInstanceId !== planInstanceId ||
          existing.artifactId !== artifactId
        ) {
          throw new Error(
            'Execution journal identity mismatch'
          );
        }

        if (
          existing.status === 'broadcasting' ||
          existing.status === 'submitted' ||
          existing.status === 'confirmed'
        ) {
          throw new Error(
            `Execution has already reached ${existing.status}`
          );
        }

        return existing;
      }

      const now = new Date().toISOString();

      return writeJournal({
        version: 1,
        executionId,
        planId,
        planInstanceId,
        artifactId,
        status: 'ready',
        createdAt: now,
        updatedAt: now,
      });
    }
  );
}

async function transitionExecution(
  executionId: string,
  expected: ExecutionStatus[],
  update: (
    current: ExecutionJournal
  ) => Omit<ExecutionJournal, 'journalSha256'>
): Promise<ExecutionJournal> {
  const path = getPath(executionId);

  await mkdir(getDirectory(), {
    recursive: true,
    mode: 0o700,
  });

  return withFileLock(
    path,
    async () => {
      const current = await loadExecutionJournal(executionId);

      if (!current) {
        throw new Error(
          'Execution journal does not exist'
        );
      }

      if (!expected.includes(current.status)) {
        throw new Error(
          `Invalid execution transition from ${current.status}`
        );
      }

      const next = update(current);

      return writeJournal(next);
    }
  );
}

export function markExecutionSigning(
  executionId: string
) {
  return transitionExecution(
    executionId,
    ['ready'],
    (current) => {
      const { journalSha256: _, ...withoutHash } = current;
      return {
        ...withoutHash,
        status: 'signing',
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

export interface BroadcastEvidence {
  transactionSignature: string;
  signedTransactionSha256: string;
  transactionMessageSha256: string;
  lastValidBlockHeight: number;
}

export function markExecutionBroadcastReady(
  executionId: string,
  evidence: BroadcastEvidence
) {
  if (
    !evidence
      .transactionSignature
      .trim()
  ) {
    throw new Error(
      'Deterministic transaction signature is required'
    );
  }

  if (
    !/^[0-9a-f]{64}$/.test(
      evidence
        .signedTransactionSha256
    )
  ) {
    throw new Error(
      'Signed transaction SHA-256 is invalid'
    );
  }

  if (
    !/^[0-9a-f]{64}$/.test(
      evidence
        .transactionMessageSha256
    )
  ) {
    throw new Error(
      'Transaction message SHA-256 is invalid'
    );
  }

  if (
    !Number.isSafeInteger(
      evidence
        .lastValidBlockHeight
    ) ||
    evidence
      .lastValidBlockHeight < 0
  ) {
    throw new Error(
      'Last valid block height is invalid'
    );
  }

  return transitionExecution(
    executionId,
    ['signing'],
    (current) => {
      const {
        journalSha256: _,
        ...withoutHash
      } = current;

      const now =
        new Date().toISOString();

      return {
        ...withoutHash,
        status: 'broadcasting',

        transactionSignature:
          evidence
            .transactionSignature,

        signedTransactionSha256:
          evidence
            .signedTransactionSha256,

        transactionMessageSha256:
          evidence
            .transactionMessageSha256,

        lastValidBlockHeight:
          evidence
            .lastValidBlockHeight,

        broadcastPreparedAt: now,
        updatedAt: now,
      };
    }
  );
}

export function markExecutionSubmitted(
  executionId: string,
  transactionSignature: string
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
    ['broadcasting'],
    (current) => {
      if (
        current
          .transactionSignature !==
        transactionSignature
      ) {
        throw new Error(
          'RPC signature does not match pre-broadcast signature'
        );
      }

      const {
        journalSha256: _,
        ...withoutHash
      } = current;

      const now =
        new Date().toISOString();

      return {
        ...withoutHash,
        status: 'submitted',
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
    [
      'broadcasting',
      'submitted',
    ],
    (current) => {
      const {
        journalSha256: _,
        ...withoutHash
      } = current;

      const now =
        new Date().toISOString();

      return {
        ...withoutHash,
        status: 'confirmed',

        submittedAt:
          current.submittedAt ??
          current.broadcastPreparedAt ??
          now,

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
  const reason = failureReason.trim();

  if (!reason) {
    throw new Error(
      'Execution failure reason is required'
    );
  }

  return transitionExecution(
    executionId,
    ['ready', 'signing'],
    (current) => {
      const { journalSha256: _, ...withoutHash } = current;
      const now = new Date().toISOString();

      return {
        ...withoutHash,
        status: 'failed',
        failedAt: now,
        failureReason: reason.slice(0, 500),
        updatedAt: now,
      };
    }
  );
}

export function markSubmittedExecutionFailed(
  executionId: string,
  failureReason: string
) {
  const reason = failureReason.trim();

  if (!reason) {
    throw new Error(
      'Execution failure reason is required'
    );
  }

  return transitionExecution(
    executionId,
    [
      'broadcasting',
      'submitted',
    ],
    (current) => {
      const { journalSha256: _, ...withoutHash } = current;
      const now = new Date().toISOString();

      return {
        ...withoutHash,
        status: 'failed',
        failedAt: now,
        failureReason: reason.slice(0, 500),
        updatedAt: now,
      };
    }
  );
}

export async function listExecutionJournals(): Promise<ExecutionJournal[]> {
  let entries: string[];

  try {
    entries = await readdir(getDirectory());
  } catch (error) {
    if ((error as { code?: string }).code === 'ENOENT') {
      return [];
    }

    throw error;
  }

  const journals: ExecutionJournal[] = [];

  for (const name of entries) {
    if (!name.endsWith('.json')) {
      continue;
    }

    const executionId = name.slice(0, -'.json'.length);

    const journal = await loadExecutionJournal(executionId);

    if (journal) {
      journals.push(journal);
    }
  }

  return journals.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt)
  );
}
