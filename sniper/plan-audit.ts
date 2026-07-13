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
