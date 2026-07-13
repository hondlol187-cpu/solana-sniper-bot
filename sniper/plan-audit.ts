import {
  mkdir,
  readFile,
  appendFile,
  chmod,
} from 'node:fs/promises';

import { join } from 'node:path';

import { config } from './config.js';
import { audit } from './audit.js';

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

async function ensureTombstoneDirectory(): Promise<void> {
  await mkdir(
    config.approvedExecutionPlanDir,
    {
      recursive: true,
      mode: 0o700,
    }
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
  let content: string;

  try {
    content = await readFile(
      getTombstonePath(),
      'utf8'
    );
  } catch {
    return [];
  }

  const tombstones: PlanTombstone[] =
    [];

  for (const line of content.split(
    '\n'
  )) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    try {
      tombstones.push(
        JSON.parse(trimmed) as PlanTombstone
      );
    } catch {
      /*
       * Skip malformed lines — tombstones are
       * append-only and a corrupt line should not
       * prevent reading the rest.
       */
    }
  }

  return tombstones;
}

/**
 * Write a tombstone for a plan that is about to be deleted,
 * then audit the deletion. Called by deleteApprovedExecutionPlan
 * and prune before the plan file is removed.
 */
export async function recordPlanDeletion(
  file: ApprovedExecutionPlanFile,
  deleteReason: string
): Promise<void> {
  await writePlanTombstone({
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
  });

  await auditPlanDeleted(
    file.planId,
    file.state.status,
    deleteReason,
    file.sha256,
    file.version
  );
}
