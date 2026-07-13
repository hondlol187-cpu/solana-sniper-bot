import {
  createHash,
} from 'node:crypto';

import {
  mkdir,
  readFile,
  appendFile,
  chmod,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';

import { join } from 'node:path';

import { config } from './config.js';
import { audit } from './audit.js';
import { withFileLock } from './file-lock.js';

import type { ApprovedExecutionPlanFile } from './execution-plan.js';

/**
 * Shared audit event-builder for plan lifecycle events.
 *
 * All plan lifecycle audits MUST go through this helper so the
 * audit chain has a consistent field set across events. Every
 * event includes the common fields (planId, planSha256, status,
 * previousStatus, version, walletPublicKey, expectedCluster)
 * plus event-specific fields.
 *
 * Events emitted:
 *   candidate.execution.plan-created
 *   candidate.execution.plan-simulated
 *   candidate.execution.plan-cancelled
 *   candidate.execution.plan-pruned
 *   candidate.execution.plan-migrated
 *   candidate.execution.plan-rejected
 *   candidate.execution.plan-deleted (tombstone-triggered)
 */

export interface PlanAuditContext {
  planId?: string;
  planSha256?: string;
  status?: string;
  previousStatus?: string;
  version?: number;
  diskVersion?: number;
  walletPublicKey?: string;
  expectedCluster?: string;
  signature?: string;
  exactMint?: string;
  approvedPoolAddress?: string;
}

function buildCommonFields(
  ctx: PlanAuditContext
): Record<string, unknown> {
  const fields: Record<
    string,
    unknown
  > = {};

  if (ctx.planId !== undefined)
    fields.planId = ctx.planId;
  if (ctx.planSha256 !== undefined)
    fields.planSha256 =
      ctx.planSha256;
  if (ctx.status !== undefined)
    fields.status = ctx.status;
  if (ctx.previousStatus !== undefined)
    fields.previousStatus =
      ctx.previousStatus;
  if (ctx.version !== undefined)
    fields.version = ctx.version;
  if (ctx.diskVersion !== undefined)
    fields.diskVersion =
      ctx.diskVersion;
  if (ctx.walletPublicKey !== undefined)
    fields.walletPublicKey =
      ctx.walletPublicKey;
  if (ctx.expectedCluster !== undefined)
    fields.expectedCluster =
      ctx.expectedCluster;
  if (ctx.signature !== undefined)
    fields.signature = ctx.signature;
  if (ctx.exactMint !== undefined)
    fields.exactMint = ctx.exactMint;
  if (ctx.approvedPoolAddress !== undefined)
    fields.approvedPoolAddress =
      ctx.approvedPoolAddress;

  return fields;
}

function buildContextFromFile(
  file: ApprovedExecutionPlanFile
): PlanAuditContext {
  return {
    planId: file.planId,
    planSha256: file.sha256,
    status: file.state.status,
    version: file.version,
    diskVersion: file.diskVersion,
    walletPublicKey:
      file.payload.walletPublicKey,
    expectedCluster:
      file.payload.expectedCluster,
  };
}

export async function auditPlanCreated(
  file: ApprovedExecutionPlanFile,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await audit(
    'candidate.execution.plan-created',
    {
      ...buildContextFromFile(file),
      ...extra,
    }
  );
}

export async function auditPlanSimulated(
  file: ApprovedExecutionPlanFile,
  previousStatus: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await audit(
    'candidate.execution.plan-simulated',
    {
      ...buildContextFromFile(file),
      previousStatus,
      ...extra,
    }
  );
}

export async function auditPlanCancelled(
  file: ApprovedExecutionPlanFile,
  previousStatus: string,
  reason: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await audit(
    'candidate.execution.plan-cancelled',
    {
      ...buildContextFromFile(file),
      previousStatus,
      reason,
      ...extra,
    }
  );
}

export async function auditPlanPruned(
  planId: string,
  previousStatus: string,
  reason: string,
  ageMs: number,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await audit(
    'candidate.execution.plan-pruned',
    {
      planId,
      previousStatus,
      reason,
      ageMs,
      ...extra,
    }
  );
}

export async function auditPlanMigrated(
  planId: string,
  fromVersion: number,
  toVersion: number,
  previousSha256: string,
  newSha256: string,
  status: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await audit(
    'candidate.execution.plan-migrated',
    {
      planId,
      previousVersion: fromVersion,
      newVersion: toVersion,
      previousSha256,
      newSha256,
      status,
      ...extra,
    }
  );
}

export async function auditPlanRejected(
  ctx: PlanAuditContext,
  reasonType: string,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await audit(
    'candidate.execution.plan-rejected',
    {
      ...buildCommonFields(ctx),
      reasonType,
      ...extra,
    }
  );
}

export async function auditPlanDeleted(
  planId: string,
  finalStatus: string,
  deleteReason: string,
  sha256: string | undefined,
  version: number | undefined,
  extra: Record<string, unknown> = {}
): Promise<void> {
  await audit(
    'candidate.execution.plan-deleted',
    {
      planId,
      finalStatus,
      deleteReason,
      ...(sha256 !== undefined
        ? { planSha256: sha256 }
        : {}),
      ...(version !== undefined
        ? { version }
        : {}),
      ...extra,
    }
  );
}

/**
 * Tombstone record for destructive plan actions.
 *
 * When a plan is deleted (via deleteApprovedExecutionPlan or
 * prune), a tombstone is appended to the tombstone index file
 * before the plan file is removed. This preserves a minimal
 * audit trail (planId, final status, deletion metadata) without
 * keeping the full executable plan on disk forever.
 */

export interface PlanTombstone {
  /*
   * Hash-chain fields for tamper-evident retention.
   * sequence starts at 1 and increments monotonically.
   * previousHash is the entryHash of the preceding
   * tombstone (null for the first entry).
   * entryHash is sha256(stableStringify({ all fields
   * except entryHash })).
   */
  sequence: number;
  previousHash: string | null;
  entryHash: string;

  deletionId: string;

  planId: string;
  finalStatus: string;
  deletedAt: string;
  deleteReason: string;
  sha256?: string;
  version?: number;
  walletPublicKey?: string;
  expectedCluster?: string;
}

function getTombstonePath(): string {
  return join(
    config.approvedExecutionPlanDir,
    'tombstones.jsonl'
  );
}

function getPlanTombstoneDir(): string {
  return join(
    config.approvedExecutionPlanDir,
    'tombstones'
  );
}

function getPlanTombstonePath(
  deletionId: string
): string {
  return join(
    getPlanTombstoneDir(),
    `${deletionId}.json`
  );
}

async function ensureTombstoneDirectory(): Promise<void> {
  await mkdir(
    config.approvedExecutionPlanDir,
    {
      recursive: true,
      mode: 0o700,
    }
  );
}

async function ensurePlanTombstoneDirectory(): Promise<void> {
  await mkdir(
    getPlanTombstoneDir(),
    {
      recursive: true,
      mode: 0o700,
    }
  );
}

/*
 * Stable stringify for hash-chain computation.
 * Same algorithm as execution-plan.ts but local to
 * this module to avoid a circular import.
 */
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
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(
    value as Record<string, unknown>
  ).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return `{${entries
    .map(
      ([key, item]) =>
        `${JSON.stringify(key)}:${stableStringify(item)}`
    )
    .join(',')}}`;
}

function computeEntryHash(
  tombstone: Omit<PlanTombstone, 'entryHash'>
): string {
  return createHash('sha256')
    .update(stableStringify(tombstone))
    .digest('hex');
}

function getLedgerLockPath(): string {
  return join(
    config.approvedExecutionPlanDir,
    'tombstones.lock'
  );
}

export async function writePlanTombstone(
  tombstone: PlanTombstone
): Promise<void> {
  await ensureTombstoneDirectory();

  const path = getTombstonePath();

  await appendFile(
    path,
    `${JSON.stringify(tombstone)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );

  await chmod(path, 0o600);
}

export async function readPlanTombstones(): Promise<
  PlanTombstone[]
> {
  /*
   * Primary source of truth: per-plan tombstone files in
   * the tombstones/ subdirectory. Each file is a single
   * JSON object (not JSONL), written atomically.
   */
  let entries: string[];

  try {
    entries = await readdir(
      getPlanTombstoneDir()
    );
  } catch {
    return [];
  }

  const tombstones: PlanTombstone[] =
    [];

  for (const name of entries) {
    if (
      !name.endsWith('.json') ||
      name.endsWith('.tmp')
    ) {
      continue;
    }

    try {
      const content = await readFile(
        join(getPlanTombstoneDir(), name),
        'utf8'
      );

      tombstones.push(
        JSON.parse(content) as PlanTombstone
      );
    } catch {
      /*
       * Skip malformed individual tombstones —
       * a corrupt file should not prevent reading
       * the rest.
       */
    }
  }

  tombstones.sort((a, b) => {
    const aMs = Date.parse(a.deletedAt);
    const bMs = Date.parse(b.deletedAt);

    if (Number.isFinite(aMs) && Number.isFinite(bMs)) {
      return aMs - bMs;
    }

    return a.planId.localeCompare(
      b.planId
    );
  });

  return tombstones;
}

/**
 * Write a tombstone for a plan that is about to be deleted,
 * then audit the deletion. Called by deleteApprovedExecutionPlan
 * and prune before the plan file is removed.
 *
 * There is one authoritative deletion transaction implementation:
 * preparePlanDeletion(). Both recordPlanDeletion and
 * recordPlanDeletionOnce delegate to it. The legacy
 * non-journal path is removed — there is no bypass.
 */
export async function recordPlanDeletion(
  file: ApprovedExecutionPlanFile,
  deleteReason: string
): Promise<void> {
  await preparePlanDeletion(
    file,
    deleteReason
  );
}

/**
 * Legacy alias for recordPlanDeletion. Delegates to
 * preparePlanDeletion — there is no separate tombstone-
 * only path.
 */
export async function recordPlanDeletionOnce(
  file: ApprovedExecutionPlanFile,
  deleteReason: string
): Promise<void> {
  await preparePlanDeletion(
    file,
    deleteReason
  );
}

export interface RetentionLedgerVerification {
  ok: boolean;
  entryCount: number;
  errors: string[];
}
export interface RetentionLedgerVerification {
  ok: boolean;
  entryCount: number;
  errors: string[];
}

/**
 * Verify the tamper-evident hash chain across all
 * retention tombstones.
 *
 * Checks:
 *   - First entry: sequence === 1, previousHash === null
 *   - Each subsequent entry: sequence === prev + 1
 *   - Each entry: previousHash === prev.entryHash
 *   - Each entry: entryHash === computed hash
 *
 * Returns { ok, entryCount, errors }. If ok is false,
 * errors contains a human-readable description of each
 * detected problem.
 */
export async function verifyPlanRetentionLedger(): Promise<RetentionLedgerVerification> {
  const tombstones =
    await readPlanTombstones();

  if (tombstones.length === 0) {
    return {
      ok: true,
      entryCount: 0,
      errors: [],
    };
  }

  /*
   * Sort by sequence for chain verification.
   * readPlanTombstones sorts by deletedAt, which
   * should match but isn't guaranteed.
   */
  tombstones.sort(
    (a, b) => a.sequence - b.sequence
  );

  const errors: string[] = [];

  let expectedSequence = 1;
  let expectedPreviousHash: string | null =
    null;

  for (
    let i = 0;
    i < tombstones.length;
    i++
  ) {
    const entry = tombstones[i];
    const label = `entry[${i}] seq=${entry.sequence} planId=${entry.planId}`;

    /*
     * Check sequence is contiguous.
     */
    if (
      entry.sequence !== expectedSequence
    ) {
      errors.push(
        `${label}: sequence gap — expected ${expectedSequence}, got ${entry.sequence}`
      );
    }

    /*
     * Check previousHash links to the prior entry.
     */
    if (
      entry.previousHash !==
      expectedPreviousHash
    ) {
      errors.push(
        `${label}: previousHash mismatch — expected ${expectedPreviousHash ?? 'null'}, got ${entry.previousHash ?? 'null'}`
      );
    }

    /*
     * Check entryHash is correct.
     */
    const { entryHash, ...rest } = entry;
    const computedHash =
      computeEntryHash(rest);

    if (computedHash !== entryHash) {
      errors.push(
        `${label}: entryHash mismatch — expected ${computedHash.slice(0, 16)}…, got ${entryHash.slice(0, 16)}…`
      );
    }

    expectedSequence =
      entry.sequence + 1;
    expectedPreviousHash = entryHash;
  }

  return {
    ok: errors.length === 0,
    entryCount: tombstones.length,
    errors,
  };
}

/**
 * Crash-consistent deletion journal.
 *
 * The journal tracks the multi-step deletion transaction:
 *   pending → ledger-recorded → audit-recorded → committed
 *
 * Only a committed journal permits removal of the plan file.
 * If a crash occurs after any intermediate state, recovery
 * can resume from the journal state without duplicating
 * ledger entries or audit events.
 *
 * The `audit-recorded` state closes the crash window between
 * the audit append and the journal commit. Recovery from
 * `ledger-recorded` uses `auditOnce` (idempotent by
 * `auditEventId`) so the audit event is never duplicated.
 */

export type DeletionJournalStatus =
  | 'pending'
  | 'ledger-recorded'
  | 'audit-recorded'
  | 'committed';

export interface PlanDeletionJournal {
  deletionId: string;
  planId: string;
  planInstanceId: string;
  planSha256: string;
  deleteReason: string;

  status: DeletionJournalStatus;

  ledgerSequence?: number;
  ledgerEntryHash?: string;
  auditEventId?: string;

  createdAt: string;
  committedAt?: string;
}

function getJournalDir(): string {
  return join(
    config.approvedExecutionPlanDir,
    'deletion-journals'
  );
}

function getJournalPath(
  deletionId: string
): string {
  return join(
    getJournalDir(),
    `${deletionId}.json`
  );
}

async function ensureJournalDirectory(): Promise<void> {
  await mkdir(getJournalDir(), {
    recursive: true,
    mode: 0o700,
  });
}

async function writeJournal(
  journal: PlanDeletionJournal
): Promise<void> {
  await ensureJournalDirectory();

  const path = getJournalPath(
    journal.deletionId
  );

  const tempPath = `${path}.tmp`;

  await writeFile(
    tempPath,
    JSON.stringify(journal, null, 2),
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );

  await rename(tempPath, path);
}

async function readJournal(
  deletionId: string
): Promise<PlanDeletionJournal | null> {
  try {
    const content = await readFile(
      getJournalPath(deletionId),
      'utf8'
    );

    return JSON.parse(
      content
    ) as PlanDeletionJournal;
  } catch {
    return null;
  }
}

/**
 * Generate a stable deletionId for a plan instance.
 * Deterministic: same planInstanceId → same deletionId.
 *
 * This ensures retries for one physical plan instance reuse
 * the same deletionId, while recreated plans (which get a
 * new planInstanceId) receive their own deletion transaction.
 */
function buildDeletionId(
  planInstanceId: string
): string {
  return createHash('sha256')
    .update(
      `plan-deletion:${planInstanceId}`
    )
    .digest('hex')
    .slice(0, 32);
}

/**
 * Stable audit event ID for the plan-deleted event.
 * Deterministic from the deletionId so recovery can
 * detect a previously-written audit event and skip
 * re-emitting it (exactly-once via auditOnce).
 */
function buildDeletionAuditEventId(
  deletionId: string
): string {
  return createHash('sha256')
    .update(
      `candidate.execution.plan-deleted:${deletionId}`
    )
    .digest('hex');
}

/**
 * Read all journals from disk. Used by recovery and doctor.
 *
 * Note: this function silently skips malformed journals.
 * For strict validation that reports malformed files, use
 * scanDeletionJournals() instead.
 */
export async function readAllJournals(): Promise<
  PlanDeletionJournal[]
> {
  const { valid } =
    await scanDeletionJournals();

  return valid;
}

export interface InvalidDeletionJournal {
  path: string;
  fileName: string;
  error: string;
}

export interface DeletionJournalScan {
  valid: PlanDeletionJournal[];
  invalid: InvalidDeletionJournal[];
}

const HEX32 = /^[0-9a-f]{32}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Validate a parsed journal object against the schema.
 * Returns an error string if invalid, null if valid.
 *
 * Validation rules:
 * - deletionId: 32 lowercase hex chars
 * - planId: non-empty string
 * - planInstanceId: non-empty string (UUID or legacy hex)
 * - planSha256: 64 hex chars
 * - deleteReason: non-empty string
 * - status: one of pending|ledger-recorded|audit-recorded|committed
 * - createdAt: valid ISO timestamp
 * - committedAt: valid ISO timestamp when status is committed
 * - ledgerSequence: positive integer when status >= ledger-recorded
 * - ledgerEntryHash: 64 hex chars when status >= ledger-recorded
 * - auditEventId: 64 hex chars when status >= audit-recorded
 */
function validateJournal(
  raw: unknown
): {
  valid: boolean;
  journal?: PlanDeletionJournal;
  error?: string;
} {
  if (
    typeof raw !== 'object' ||
    raw === null
  ) {
    return {
      valid: false,
      error: 'Journal is not an object',
    };
  }

  const j = raw as Record<
    string,
    unknown
  >;

  if (
    typeof j.deletionId !== 'string' ||
    !HEX32.test(j.deletionId)
  ) {
    return {
      valid: false,
      error: `Invalid deletionId: ${String(j.deletionId)}`,
    };
  }

  if (
    typeof j.planId !== 'string' ||
    j.planId.length === 0
  ) {
    return {
      valid: false,
      error: 'planId is missing or empty',
    };
  }

  if (
    typeof j.planInstanceId !==
      'string' ||
    j.planInstanceId.length === 0
  ) {
    return {
      valid: false,
      error:
        'planInstanceId is missing or empty',
    };
  }

  if (
    typeof j.planSha256 !== 'string' ||
    !HEX64.test(j.planSha256)
  ) {
    return {
      valid: false,
      error: `Invalid planSha256: ${String(j.planSha256)}`,
    };
  }

  if (
    typeof j.deleteReason !== 'string' ||
    j.deleteReason.length === 0
  ) {
    return {
      valid: false,
      error: 'deleteReason is missing or empty',
    };
  }

  const validStatuses = new Set([
    'pending',
    'ledger-recorded',
    'audit-recorded',
    'committed',
  ]);

  if (
    typeof j.status !== 'string' ||
    !validStatuses.has(j.status)
  ) {
    return {
      valid: false,
      error: `Invalid status: ${String(j.status)}`,
    };
  }

  if (
    typeof j.createdAt !== 'string' ||
    !ISO_TIMESTAMP.test(j.createdAt)
  ) {
    return {
      valid: false,
      error: `Invalid createdAt: ${String(j.createdAt)}`,
    };
  }

  /*
   * State-specific validation.
   */
  const status = j.status as DeletionJournalStatus;

  if (
    status === 'ledger-recorded' ||
    status === 'audit-recorded' ||
    status === 'committed'
  ) {
    if (
      typeof j.ledgerSequence !==
        'number' ||
      !Number.isInteger(
        j.ledgerSequence
      ) ||
      j.ledgerSequence < 1
    ) {
      return {
        valid: false,
        error: `Invalid ledgerSequence for status ${status}: ${String(j.ledgerSequence)}`,
      };
    }

    if (
      typeof j.ledgerEntryHash !==
        'string' ||
      !HEX64.test(j.ledgerEntryHash)
    ) {
      return {
        valid: false,
        error: `Invalid ledgerEntryHash for status ${status}: ${String(j.ledgerEntryHash)}`,
      };
    }
  }

  if (
    status === 'pending' &&
    (j.ledgerSequence !== undefined ||
      j.ledgerEntryHash !== undefined)
  ) {
    return {
      valid: false,
      error:
        'pending journal must not have ledger fields',
    };
  }

  if (
    status === 'audit-recorded' ||
    status === 'committed'
  ) {
    if (
      typeof j.auditEventId !==
        'string' ||
      !HEX64.test(j.auditEventId)
    ) {
      return {
        valid: false,
        error: `Invalid auditEventId for status ${status}: ${String(j.auditEventId)}`,
      };
    }
  }

  if (status === 'committed') {
    if (
      typeof j.committedAt !==
        'string' ||
      !ISO_TIMESTAMP.test(j.committedAt)
    ) {
      return {
        valid: false,
        error: `Invalid committedAt: ${String(j.committedAt)}`,
      };
    }
  }

  return {
    valid: true,
    journal: j as unknown as PlanDeletionJournal,
  };
}

/**
 * Scan all deletion journals with strict validation.
 * Unlike readAllJournals, this does NOT silently skip
 * malformed files — each failure is captured with its
 * path, fileName, and error message so doctor/recovery
 * can surface corrupt journals for investigation.
 */
export async function scanDeletionJournals(): Promise<DeletionJournalScan> {
  let entries: string[];

  try {
    entries = await readdir(
      getJournalDir()
    );
  } catch {
    return {
      valid: [],
      invalid: [],
    };
  }

  const valid: PlanDeletionJournal[] =
    [];
  const invalid: InvalidDeletionJournal[] =
    [];

  for (const name of entries) {
    if (
      !name.endsWith('.json') ||
      name.endsWith('.tmp')
    ) {
      continue;
    }

    const fullPath = join(
      getJournalDir(),
      name
    );

    try {
      const content = await readFile(
        fullPath,
        'utf8'
      );

      const parsed = JSON.parse(content);

      const result =
        validateJournal(parsed);

      if (result.valid && result.journal) {
        valid.push(result.journal);
      } else {
        invalid.push({
          path: fullPath,
          fileName: name,
          error:
            result.error ??
            'Unknown validation error',
        });
      }
    } catch (error) {
      invalid.push({
        path: fullPath,
        fileName: name,
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  return { valid, invalid };
}

export interface DeletionTransactionVerification {
  ok: boolean;
  errors: string[];
  journalCount: number;
  tombstoneCount: number;
}

/**
 * Cross-check deletion journals against the retention
 * ledger. For every ledger-recorded, audit-recorded, or
 * committed journal, require exactly one matching tombstone
 * with the same deletionId, planId, planSha256, sequence,
 * and entry hash.
 *
 * Also detects:
 * - ledger entry without a journal
 * - duplicate deletion IDs
 * - journal pointing to the wrong ledger entry
 */
export async function verifyDeletionTransactions(): Promise<DeletionTransactionVerification> {
  const { valid: journals, invalid } =
    await scanDeletionJournals();

  const tombstones =
    await readPlanTombstones();

  const errors: string[] = [];

  /*
   * Report invalid journals.
   */
  for (const inv of invalid) {
    errors.push(
      `Malformed journal ${inv.fileName}: ${inv.error}`
    );
  }

  /*
   * Check for duplicate deletion IDs.
   */
  const seenDeletionIds = new Set<
    string
  >();

  for (const j of journals) {
    if (seenDeletionIds.has(j.deletionId)) {
      errors.push(
        `Duplicate deletionId: ${j.deletionId}`
      );
    }

    seenDeletionIds.add(j.deletionId);
  }

  /*
   * For each journal with status >= ledger-recorded,
   * find the matching tombstone and verify fields.
   */
  const tombstoneByDeletionId = new Map(
    tombstones.map((t) => [
      t.deletionId,
      t,
    ])
  );

  for (const j of journals) {
    if (j.status === 'pending') continue;

    const tombstone =
      tombstoneByDeletionId.get(
        j.deletionId
      );

    if (!tombstone) {
      errors.push(
        `Journal ${j.deletionId} (status ${j.status}) has no matching ledger entry`
      );

      continue;
    }

    if (tombstone.planId !== j.planId) {
      errors.push(
        `Journal ${j.deletionId} planId mismatch: journal ${j.planId}, ledger ${tombstone.planId}`
      );
    }

    if (tombstone.sha256 !== j.planSha256) {
      errors.push(
        `Journal ${j.deletionId} planSha256 mismatch: journal ${j.planSha256}, ledger ${tombstone.sha256}`
      );
    }

    if (
      j.ledgerSequence !== undefined &&
      tombstone.sequence !==
        j.ledgerSequence
    ) {
      errors.push(
        `Journal ${j.deletionId} sequence mismatch: journal ${j.ledgerSequence}, ledger ${tombstone.sequence}`
      );
    }

    if (
      j.ledgerEntryHash !== undefined &&
      tombstone.entryHash !==
        j.ledgerEntryHash
    ) {
      errors.push(
        `Journal ${j.deletionId} entryHash mismatch: journal ${j.ledgerEntryHash}, ledger ${tombstone.entryHash}`
      );
    }
  }

  /*
   * Check for orphan ledger entries (tombstones
   * without a matching journal).
   */
  const journalDeletionIds = new Set(
    journals.map((j) => j.deletionId)
  );

  for (const t of tombstones) {
    if (
      !journalDeletionIds.has(t.deletionId)
    ) {
      errors.push(
        `Orphan ledger entry: tombstone ${t.deletionId} has no matching journal`
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    journalCount: journals.length,
    tombstoneCount: tombstones.length,
  };
}

/**
 * Find an existing ledger entry by deletionId.
 * Returns the tombstone if found, null otherwise.
 */
async function findTombstoneByDeletionId(
  deletionId: string
): Promise<PlanTombstone | null> {
  const tombstones =
    await readPlanTombstones();

  return (
    tombstones.find(
      (t) => t.deletionId === deletionId
    ) ?? null
  );
}

/**
 * Prepare a plan deletion transaction with crash-consistent
 * semantics. The journal transitions through:
 *
 *   pending → ledger-recorded → committed
 *
 * Steps (all under the ledger lock):
 *   1. Load or create stable deletionId.
 *   2. Validate planId + planSha256 on retry.
 *   3. Write pending journal atomically.
 *   4. Append ledger exactly once (idempotent by deletionId).
 *   5. Mark ledger-recorded.
 *   6. Emit audit with deletionId.
 *   7. Mark committed.
 *   8. Return committed journal.
 *
 * If a crash occurs at any point, recovery can resume from
 * the journal state. The plan file is NOT removed here —
 * the caller must check journal.status === 'committed'
 * before calling rm().
 */
export async function preparePlanDeletion(
  file: ApprovedExecutionPlanFile,
  deleteReason: string
): Promise<PlanDeletionJournal> {
  const deletionId = buildDeletionId(
    file.planInstanceId
  );

  /*
   * Acquire the ledger lock for the entire transaction
   * so the journal state transitions and the ledger
   * append are atomic with respect to other deletions.
   */
  return withFileLock(
    getLedgerLockPath(),
    async () => {
      /*
       * Step 1-2: Check for an existing journal
       * (retry case).
       */
      const existing =
        await readJournal(deletionId);

      if (existing) {
        /*
         * With planInstanceId-based deletionIds, a recreated
         * plan gets a new planInstanceId → new deletionId →
         * no existing journal. So finding an existing journal
         * means this is a retry of the same physical plan
         * instance.
         *
         * Validate: the existing journal must reference the
         * same planSha256. A mismatch means the plan changed
         * between deletion attempts (crash mid-transaction) —
         * fail closed.
         *
         * We NEVER delete an old tombstone to begin another
         * deletion cycle. Each physical plan instance has its
         * own deletionId and its own tombstone.
         */
        if (
          existing.planSha256 !==
          file.sha256
        ) {
          throw new Error(
            `Plan SHA-256 conflict in deletion journal ${deletionId}: journal has ${existing.planSha256}, plan has ${file.sha256}`
          );
        }

        /*
         * planSha256 matches — resume from the
         * existing journal state.
         */
        return resumeJournal(
          existing,
          file,
          deleteReason
        );
      }

      /*
       * Step 3: Write pending journal.
       */
      const pendingJournal: PlanDeletionJournal = {
        deletionId,
        planId: file.planId,
        planInstanceId:
          file.planInstanceId,
        planSha256: file.sha256,
        deleteReason,
        status: 'pending',
        createdAt:
          new Date().toISOString(),
      };

      await writeJournal(pendingJournal);

      /*
       * Steps 4-7: Record ledger, audit, commit.
       */
      return resumeJournal(
        pendingJournal,
        file,
        deleteReason
      );
    }
  );
}

/**
 * Resume a journal from its current state to 'committed'.
 * Called under the ledger lock. Handles all four states:
 *
 *   pending: append ledger, mark ledger-recorded, then
 *            emit audit via auditOnce, mark audit-recorded,
 *            then mark committed.
 *
 *   ledger-recorded: ledger already appended (idempotent),
 *                     just emit audit via auditOnce, mark
 *                     audit-recorded, then mark committed.
 *
 *   audit-recorded: audit already emitted (idempotent),
 *                    just mark committed.
 *
 *   committed: no-op, return as-is.
 */
async function resumeJournal(
  journal: PlanDeletionJournal,
  file: ApprovedExecutionPlanFile,
  deleteReason: string
): Promise<PlanDeletionJournal> {
  if (
    journal.status === 'committed'
  ) {
    return journal;
  }

  let current = journal;

  /*
   * Step 4: Append to ledger if not already done.
   * Check by deletionId — if a tombstone with this
   * deletionId already exists, skip the append.
   */
  if (
    current.status === 'pending'
  ) {
    const existingTombstone =
      await findTombstoneByDeletionId(
        current.deletionId
      );

    let tombstone: PlanTombstone;

    if (existingTombstone) {
      /*
       * Ledger entry already exists (crash after
       * append but before journal update). Reuse it.
       */
      tombstone = existingTombstone;
    } else {
      /*
       * Append a new ledger entry.
       */
      const existing =
        await readPlanTombstones();

      const lastEntry =
        existing.length > 0
          ? existing[existing.length - 1]
          : null;

      const sequence = lastEntry
        ? lastEntry.sequence + 1
        : 1;

      const previousHash = lastEntry
        ? lastEntry.entryHash
        : null;

      const tombstoneWithoutHash: Omit<
        PlanTombstone,
        'entryHash'
      > = {
        sequence,
        previousHash,
        deletionId: current.deletionId,
        planId: file.planId,
        finalStatus: file.state.status,
        deletedAt:
          new Date().toISOString(),
        deleteReason,
        sha256: file.sha256,
        version: file.version,
        walletPublicKey:
          file.payload.walletPublicKey,
        expectedCluster:
          file.payload.expectedCluster,
      };

      const entryHash =
        computeEntryHash(
          tombstoneWithoutHash
        );

      tombstone = {
        ...tombstoneWithoutHash,
        entryHash,
      };

      /*
       * Write per-plan tombstone atomically.
       */
      await ensurePlanTombstoneDirectory();

      const perPlanPath =
        getPlanTombstonePath(
          current.deletionId
        );

      const tempPath =
        `${perPlanPath}.tmp`;

      await writeFile(
        tempPath,
        JSON.stringify(tombstone, null, 2),
        {
          encoding: 'utf8',
          mode: 0o600,
        }
      );

      await rename(tempPath, perPlanPath);

      /*
       * Also append to JSONL for convenience.
       */
      await writePlanTombstone(tombstone);
    }

    /*
     * Step 5: Mark ledger-recorded.
     */
    current = {
      ...current,
      status: 'ledger-recorded',
      ledgerSequence: tombstone.sequence,
      ledgerEntryHash: tombstone.entryHash,
    };

    await writeJournal(current);
  }

  /*
   * Step 6: Emit audit via auditOnce (idempotent by
   * auditEventId). If the audit was already emitted
   * (crash after audit but before journal update),
   * auditOnce returns { written: false } and we
   * skip the duplicate. Either way, mark audit-recorded.
   */
  if (
    current.status === 'ledger-recorded'
  ) {
    const auditEventId =
      buildDeletionAuditEventId(
        current.deletionId
      );

    const { auditOnce } = await import(
      './audit.js'
    );

    await auditOnce(
      'candidate.execution.plan-deleted',
      auditEventId,
      {
        planId: file.planId,
        finalStatus: file.state.status,
        deleteReason,
        planSha256: file.sha256,
        version: file.version,
        deletionId: current.deletionId,
        planInstanceId:
          file.planInstanceId,
        ledgerSequence:
          current.ledgerSequence,
        ledgerEntryHash:
          current.ledgerEntryHash,
      }
    );

    current = {
      ...current,
      status: 'audit-recorded',
      auditEventId,
    };

    await writeJournal(current);
  }

  /*
   * Step 7: Mark committed.
   */
  if (
    current.status === 'audit-recorded'
  ) {
    current = {
      ...current,
      status: 'committed',
      committedAt:
        new Date().toISOString(),
    };

    await writeJournal(current);
  }

  /*
   * Step 8: Return committed journal.
   */
  return current;
}

/**
 * Recover pending, ledger-recorded, or audit-recorded
 * deletion journals.
 *
 * Resumes each unresolved journal to 'committed' state.
 * Does NOT remove plan files — the caller must do that
 * separately after checking journal.status === 'committed'.
 *
 * Refuses to operate if malformed journals exist — the
 * caller must investigate and fix or remove the malformed
 * journal before recovery can proceed.
 *
 * Returns:
 *   recovered: deletionIds that were advanced to committed
 *   pending: deletionIds that could not be resolved
 *   conflicts: deletionIds with plan SHA conflicts
 *   malformed: fileNames of journals that failed validation
 */
export async function recoverPendingPlanDeletions(): Promise<{
  recovered: string[];
  pending: string[];
  conflicts: string[];
  malformed: string[];
}> {
  const { valid: journals, invalid: invalidJournals } =
    await scanDeletionJournals();

  const recovered: string[] = [];
  const pending: string[] = [];
  const conflicts: string[] = [];
  const malformed = invalidJournals.map(
    (j) => j.fileName
  );

  /*
   * If there are malformed journals, refuse to recover
   * any. The caller must investigate and fix or remove
   * the malformed journal first.
   */
  if (malformed.length > 0) {
    return {
      recovered,
      pending,
      conflicts,
      malformed,
    };
  }

  for (const journal of journals) {
    if (
      journal.status === 'committed'
    ) {
      /*
       * Already committed — nothing to recover.
       * The plan file may or may not still exist;
       * the caller (doctor) checks that separately.
       */
      continue;
    }

    /*
     * Try to resume the journal. We need to load the
     * plan file to validate planSha256. If the plan
     * file is gone, we can't resume — leave it pending.
     */
    try {
      const { loadApprovedExecutionPlan } =
        await import(
          './execution-plan.js'
        );

      const file =
        await loadApprovedExecutionPlan(
          journal.planId
        );

      if (
        file.sha256 !==
        journal.planSha256
      ) {
        conflicts.push(
          journal.deletionId
        );

        continue;
      }

      /*
       * Resume under the ledger lock.
       */
      await withFileLock(
        getLedgerLockPath(),
        async () => {
          await resumeJournal(
            journal,
            file,
            journal.deleteReason
          );
        }
      );

      recovered.push(
        journal.deletionId
      );
    } catch {
      pending.push(
        journal.deletionId
      );
    }
  }

  return {
    recovered,
    pending,
    conflicts,
    malformed,
  };
}

export interface DeletionJournalHealth {
  total: number;
  valid: number;
  invalid: number;
  pending: number;
  ledgerRecorded: number;
  auditRecorded: number;
  committed: number;
  committedButPlanExists: number;
  conflicts: number;
  crossCheckErrors: string[];
  journals: PlanDeletionJournal[];
  invalidJournals: InvalidDeletionJournal[];
}

/**
 * Assess deletion journal health for the doctor CLI.
 * Uses scanDeletionJournals for strict validation and
 * verifyDeletionTransactions for cross-checking against
 * the retention ledger. Any malformed journal or cross-
 * check error sets the journal-health exit bit.
 */
export async function assessDeletionJournalHealth(): Promise<DeletionJournalHealth> {
  const { valid: journals, invalid: invalidJournals } =
    await scanDeletionJournals();

  let pending = 0;
  let ledgerRecorded = 0;
  let auditRecorded = 0;
  let committed = 0;
  let committedButPlanExists = 0;
  let conflicts = 0;

  for (const journal of journals) {
    if (journal.status === 'pending') {
      pending++;
    } else if (
      journal.status === 'ledger-recorded'
    ) {
      ledgerRecorded++;
    } else if (
      journal.status === 'audit-recorded'
    ) {
      auditRecorded++;
    } else if (
      journal.status === 'committed'
    ) {
      committed++;

      /*
       * Check if the plan file still exists.
       */
      try {
        const { getApprovedExecutionPlanPath } =
          await import(
            './execution-plan.js'
          );

        const { access } = await import(
          'node:fs/promises'
        );

        await access(
          getApprovedExecutionPlanPath(
            journal.planId
          )
        );

        committedButPlanExists++;
      } catch {
        /*
         * Plan file is gone — expected for
         * committed journals.
         */
      }
    }
  }

  /*
   * Check for SHA conflicts by looking for journals
   * whose planSha256 doesn't match the current plan
   * file (if it exists).
   */
  for (const journal of journals) {
    try {
      const { loadApprovedExecutionPlan } =
        await import(
          './execution-plan.js'
        );

      const file =
        await loadApprovedExecutionPlan(
          journal.planId
        );

      if (
        file.sha256 !==
        journal.planSha256
      ) {
        conflicts++;
      }
    } catch {
      /*
       * Plan can't be loaded — not a conflict,
       * just means it's gone or corrupt.
       */
    }
  }

  /*
   * Cross-check journals against the retention ledger.
   */
  const crossCheck =
    await verifyDeletionTransactions();

  return {
    total:
      journals.length +
      invalidJournals.length,
    valid: journals.length,
    invalid: invalidJournals.length,
    pending,
    ledgerRecorded,
    auditRecorded,
    committed,
    committedButPlanExists,
    conflicts,
    crossCheckErrors: crossCheck.errors,
    journals,
    invalidJournals,
  };
}
