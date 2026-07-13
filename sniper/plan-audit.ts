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
  planId: string
): string {
  return join(
    getPlanTombstoneDir(),
    `${planId}.json`
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
 * This now delegates to recordPlanDeletionOnce for hash-chain
 * consistency. The legacy non-idempotent JSONL-only path is
 * no longer used.
 */
export async function recordPlanDeletion(
  file: ApprovedExecutionPlanFile,
  deleteReason: string
): Promise<void> {
  await recordPlanDeletionOnce(
    file,
    deleteReason
  );
}

/**
 * Idempotent tombstone recorder. Writes a per-plan tombstone
 * file at tombstones/<planId>.json using atomic write (temp +
 * rename, mode 0o600). If the file already exists, this is a
 * no-op — the plan was already tombstoned.
 *
 * Also appends to the JSONL file for convenience and emits the
 * audit event. The per-plan file is the source of truth; the
 * JSONL is secondary.
 *
 * Does NOT catch persistence errors — callers must handle them
 * (fail-closed).
 */
export async function recordPlanDeletionOnce(
  file: ApprovedExecutionPlanFile,
  deleteReason: string
): Promise<void> {
  await ensurePlanTombstoneDirectory();

  const perPlanPath =
    getPlanTombstonePath(file.planId);

  /*
   * Check if the per-plan tombstone already exists.
   * If it does, this is a retry — skip the write and
   * audit. The plan was already tombstoned.
   */
  try {
    await readFile(
      perPlanPath,
      'utf8'
    );

    return;
  } catch {
    /*
     * File does not exist — proceed with write.
     */
  }

  /*
   * Acquire a ledger-level lock so the sequence
   * number and previousHash are computed atomically
   * with respect to other concurrent deletions.
   * The per-plan lock (held by deleteApprovedExecutionPlan)
   * prevents the same plan from being deleted twice,
   * but the ledger lock prevents two DIFFERENT plans
   * from getting the same sequence number.
   */
  await withFileLock(
    getLedgerLockPath(),
    async () => {
      /*
       * Re-check inside the ledger lock in case
       * another process wrote the tombstone while
       * we were waiting.
       */
      try {
        await readFile(
          perPlanPath,
          'utf8'
        );

        return;
      } catch {
        /* proceed */
      }

      /*
       * Read all existing tombstones to find the
       * last entry's hash and sequence number.
       */
      const existing =
        await readPlanTombstones();

      const lastEntry =
        existing.length > 0
          ? existing[
              existing.length - 1
            ]
          : null;

      const sequence =
        lastEntry
          ? lastEntry.sequence + 1
          : 1;

      const previousHash =
        lastEntry
          ? lastEntry.entryHash
          : null;

      const tombstoneWithoutHash: Omit<
        PlanTombstone,
        'entryHash'
      > = {
        sequence,
        previousHash,
        deletionId: buildDeletionId(
          file.planId
        ),
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

      const tombstone: PlanTombstone = {
        ...tombstoneWithoutHash,
        entryHash,
      };

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

      await rename(
        tempPath,
        perPlanPath
      );

      /*
       * Also append to the JSONL file for convenience.
       */
      await writePlanTombstone(tombstone);

      await auditPlanDeleted(
        file.planId,
        file.state.status,
        deleteReason,
        file.sha256,
        file.version
      );
    }
  );
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
 *   pending → ledger-recorded → committed
 *
 * Only a committed journal permits removal of the plan file.
 * If a crash occurs after 'pending' or 'ledger-recorded',
 * recovery can resume from the journal state without
 * duplicating ledger entries or losing audit records.
 */

export interface PlanDeletionJournal {
  deletionId: string;
  planId: string;
  planSha256: string;
  deleteReason: string;

  status:
    | 'pending'
    | 'ledger-recorded'
    | 'committed';

  ledgerSequence?: number;
  ledgerEntryHash?: string;

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
 * Generate a stable deletionId for a plan.
 * Deterministic: same planId → same deletionId.
 * This ensures retries produce the same id even if
 * the plan's sha256 has changed (which would trigger
 * a conflict check rather than a new journal).
 */
function buildDeletionId(
  planId: string
): string {
  return createHash('sha256')
    .update(planId)
    .digest('hex')
    .slice(0, 32);
}

/**
 * Read all journals from disk. Used by recovery and doctor.
 */
export async function readAllJournals(): Promise<
  PlanDeletionJournal[]
> {
  let entries: string[];

  try {
    entries = await readdir(
      getJournalDir()
    );
  } catch {
    return [];
  }

  const journals: PlanDeletionJournal[] =
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
        join(getJournalDir(), name),
        'utf8'
      );

      journals.push(
        JSON.parse(
          content
        ) as PlanDeletionJournal
      );
    } catch {
      /* skip malformed */
    }
  }

  return journals;
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
    file.planId
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
         * If the existing journal is committed AND
         * the planSha256 differs, the old deletion
         * completed and this is a new plan re-created
         * after deletion. Allow a new journal cycle
         * by falling through to create a fresh one.
         *
         * If the journal is pending or ledger-recorded
         * AND the planSha256 differs, that's a real
         * conflict — a crash happened mid-deletion and
         * the plan changed. Fail closed.
         */
        if (
          existing.planSha256 !==
          file.sha256
        ) {
          if (
            existing.status !==
            'committed'
          ) {
            throw new Error(
              `Plan SHA-256 conflict in deletion journal ${deletionId}: journal has ${existing.planSha256}, plan has ${file.sha256}`
            );
          }

          /*
           * Old journal is committed with a different
           * sha256 — this is a re-created plan. Remove
           * the old per-plan tombstone so the new
           * deletion creates a fresh one, then fall
           * through to create a new journal.
           */
          await rm(
            getPlanTombstonePath(
              file.planId
            ),
            { force: true }
          );
        } else {
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
      }

      /*
       * Step 3: Write pending journal.
       */
      const pendingJournal: PlanDeletionJournal = {
        deletionId,
        planId: file.planId,
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
 * Called under the ledger lock. Handles all three states:
 *
 *   pending: append ledger, mark ledger-recorded, then
 *            emit audit, mark committed.
 *
 *   ledger-recorded: ledger already appended (idempotent),
 *                     just emit audit and mark committed.
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
        getPlanTombstonePath(file.planId);

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
   * Step 6: Emit audit with deletionId.
   * (Idempotent — if the audit was already emitted,
   * re-emitting is safe since audit is append-only.)
   */
  await auditPlanDeleted(
    file.planId,
    file.state.status,
    deleteReason,
    file.sha256,
    file.version,
    {
      deletionId: current.deletionId,
      ledgerSequence:
        current.ledgerSequence,
      ledgerEntryHash:
        current.ledgerEntryHash,
    }
  );

  /*
   * Step 7: Mark committed.
   */
  current = {
    ...current,
    status: 'committed',
    committedAt:
      new Date().toISOString(),
  };

  await writeJournal(current);

  /*
   * Step 8: Return committed journal.
   */
  return current;
}

/**
 * Recover pending or ledger-recorded deletion journals.
 *
 * Resumes each unresolved journal to 'committed' state.
 * Does NOT remove plan files — the caller must do that
 * separately after checking journal.status === 'committed'.
 *
 * Returns:
 *   recovered: deletionIds that were advanced to committed
 *   pending: deletionIds that could not be resolved
 *   conflicts: deletionIds with plan SHA conflicts
 */
export async function recoverPendingPlanDeletions(): Promise<{
  recovered: string[];
  pending: string[];
  conflicts: string[];
}> {
  const journals =
    await readAllJournals();

  const recovered: string[] = [];
  const pending: string[] = [];
  const conflicts: string[] = [];

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

  return { recovered, pending, conflicts };
}

export interface DeletionJournalHealth {
  total: number;
  pending: number;
  ledgerRecorded: number;
  committed: number;
  committedButPlanExists: number;
  conflicts: number;
  journals: PlanDeletionJournal[];
}

/**
 * Assess deletion journal health for the doctor CLI.
 * Reports counts by status, identifies committed journals
 * whose plan file still exists (should be removed), and
 * detects SHA conflicts.
 */
export async function assessDeletionJournalHealth(): Promise<DeletionJournalHealth> {
  const journals =
    await readAllJournals();

  let pending = 0;
  let ledgerRecorded = 0;
  let committed = 0;
  let committedButPlanExists = 0;
  let conflicts = 0;

  for (const journal of journals) {
    if (
      journal.status === 'pending'
    ) {
      pending++;
    } else if (
      journal.status ===
      'ledger-recorded'
    ) {
      ledgerRecorded++;
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

  return {
    total: journals.length,
    pending,
    ledgerRecorded,
    committed,
    committedButPlanExists,
    conflicts,
    journals,
  };
}
