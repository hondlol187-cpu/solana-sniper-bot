import {
  createHash,
} from 'node:crypto';

import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';

import { join } from 'node:path';

import { config } from './config.js';

import {
  withFileLock,
} from './file-lock.js';

export interface ApprovedExecutionPlanPayload {
  signature: string;
  exactMint: string;
  createdAt: string;
  quoteReceivedAtMs: number;

  walletPublicKey: string;
  expectedCluster: string;
  buyLamports: string;

  approvedPoolAddress: string;
  approvedQuoteMint: string;
  approvedLiquiditySol: number;

  currentPoolAddress: string;
  currentQuoteMint: string;
  currentLiquiditySol: number;

  routeHopCount: number;
  routeLabels: string[];
  routeAmmKeys: string[];

  quoteInputMint: string;
  quoteOutputMint: string;
  quoteInAmount: string;
  quoteOutAmount: string;
  quoteOtherAmountThreshold: string;
  quoteSlippageBps: number;
  quotePriceImpactPct: string;
  quoteRoutePlan: unknown[];

  routeOk: boolean;
  routeReasons: string[];

  approvalOk: boolean;
  approvalReasons: string[];
  quoteAgeMs: number;
  liquidityDropPct: number | null;
}

export interface ApprovedExecutionPlanState {
  status: 'prepared' | 'simulated' | 'cancelled';
  simulationCount: number;
  createdAt: string;
  simulatedAt?: string;
  cancelledAt?: string;
  lastSimulationResult?: string;
  cancellationReason?: string;
  simulationReceipt?: SimulationReceipt;
}

export interface SimulationReceipt {
  transactionMessageSha256: string;
  serializedTransactionSha256: string;

  recentBlockhash: string;
  lastValidBlockHeight?: number;

  simulatedAt: string;
  rpcEndpoint: string;
  contextSlot: number;

  err: unknown | null;
  unitsConsumed?: number;
  logsSha256: string;
  returnDataSha256?: string;

  walletPublicKey: string;
  expectedCluster: string;
  planSha256BeforeSimulation: string;
}

/**
 * Legacy v1 plan file shape — written before the
 * `cancelledAt` state field was added. v1 files are
 * still loadable but should be migrated to v2.
 */
export type LegacyApprovedExecutionPlanFileV1 = {
  version: 1;
  planId: string;
  state: {
    status: 'prepared' | 'simulated' | 'cancelled';
    simulationCount: number;
    createdAt: string;
    simulatedAt?: string;
    lastSimulationResult?: string;
    cancellationReason?: string;
  };
  payload: ApprovedExecutionPlanPayload;
  sha256: string;
};

/**
 * Current in-memory plan file shape. `version` is always 2
 * (the current schema) for normalized in-memory objects.
 * `diskVersion` records which schema version was on disk when
 * the file was loaded — it may be 1 for legacy files that
 * haven't been migrated or rewritten yet.
 *
 * On-disk files do NOT carry a `diskVersion` field; only
 * `version` (1 or 2) is written to disk. `diskVersion` is
 * an in-memory-only annotation for migration/audit logic.
 */
export interface ApprovedExecutionPlanFile {
  version: 2;
  diskVersion: 1 | 2;
  planId: string;
  state: ApprovedExecutionPlanState;
  payload: ApprovedExecutionPlanPayload;
  sha256: string;
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

function hashPlanContent(
  input: {
    version: 1 | 2;
    planId: string;
    state: ApprovedExecutionPlanState;
    payload: ApprovedExecutionPlanPayload;
  }
): string {
  return createHash('sha256')
    .update(stableStringify(input))
    .digest('hex');
}

/** Version-specific hash wrappers for explicit migration logic. */
function hashV1PlanContent(
  input: Omit<LegacyApprovedExecutionPlanFileV1, 'sha256'>
): string {
  return hashPlanContent(input);
}

function hashV2PlanContent(
  input: {
    version: 2;
    planId: string;
    state: ApprovedExecutionPlanState;
    payload: ApprovedExecutionPlanPayload;
  }
): string {
  return hashPlanContent(input);
}

/**
 * Normalize a parsed on-disk file (v1 or v2) into the
 * current in-memory shape. `version` is always 2 (the
 * current schema); `diskVersion` preserves the on-disk
 * version so migration/audit logic can detect legacy files.
 */
function normalizePlanFile(
  parsed: {
    version: 1 | 2;
    planId: string;
    state: ApprovedExecutionPlanState;
    payload: ApprovedExecutionPlanPayload;
    sha256: string;
  }
): ApprovedExecutionPlanFile {
  return {
    version: 2,
    diskVersion: parsed.version,
    planId: parsed.planId,
    state: parsed.state,
    payload: parsed.payload,
    sha256: parsed.sha256,
  };
}

function buildPlanId(
  payload: ApprovedExecutionPlanPayload
): string {
  const shortHash =
    createHash('sha256')
      .update(
        [
          payload.signature,
          payload.exactMint,
          payload.createdAt,
          payload.walletPublicKey,
        ].join('|')
      )
      .digest('hex')
      .slice(0, 16);

  return [
    payload.signature.slice(0, 12),
    payload.exactMint.slice(0, 12),
    shortHash,
  ].join('_');
}

export function getApprovedExecutionPlanPath(
  planId: string
): string {
  return join(
    config.approvedExecutionPlanDir,
    `${planId}.json`
  );
}

async function ensurePlanDirectory(): Promise<void> {
  await mkdir(
    config.approvedExecutionPlanDir,
    {
      recursive: true,
      mode: 0o700,
    }
  );
}

/**
 * Atomically write a plan file to disk. Always writes
 * `version: 2` and computes the v2 hash — the caller does
 * not pass a version field. This is the single chokepoint
 * that enforces "all new writes are v2".
 */
async function saveApprovedExecutionPlanFile(
  file: {
    planId: string;
    state: ApprovedExecutionPlanState;
    payload: ApprovedExecutionPlanPayload;
  }
): Promise<ApprovedExecutionPlanFile> {
  await ensurePlanDirectory();

  const onDiskContent = {
    version: 2 as const,
    planId: file.planId,
    state: file.state,
    payload: file.payload,
  };

  const sha256 =
    hashV2PlanContent(onDiskContent);

  const complete = {
    ...onDiskContent,
    sha256,
  };

  const path =
    getApprovedExecutionPlanPath(
      complete.planId
    );

  const temporaryFile =
    `${path}.tmp`;

  await writeFile(
    temporaryFile,
    JSON.stringify(complete, null, 2),
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );

  await rename(
    temporaryFile,
    path
  );

  return {
    version: 2,
    diskVersion: 2,
    planId: complete.planId,
    state: complete.state,
    payload: complete.payload,
    sha256: complete.sha256,
  };
}

/**
 * Lock target for per-plan mutual exclusion. Locks live at
 * `<plan-path>.lock` and are owned by sniper/file-lock.ts.
 */
function getApprovedExecutionPlanLockTarget(
  planId: string
): string {
  return getApprovedExecutionPlanPath(planId);
}

export async function writeApprovedExecutionPlan(
  payload: ApprovedExecutionPlanPayload
): Promise<ApprovedExecutionPlanFile> {
  const planId =
    buildPlanId(payload);

  /*
   * Ensure the plan directory exists BEFORE acquiring the
   * lock, because withFileLock opens `<plan-path>.lock` and
   * Node's `open(..., 'wx')` will fail with ENOENT if the
   * parent directory does not yet exist.
   */
  await ensurePlanDirectory();

  /*
   * Lock on the final plan path so that two concurrent
   * writes with identical payloads (same signature, mint,
   * createdAt, wallet) cannot race on the same file. The
   * lock file is created at `<plan-path>.lock`.
   */
  return withFileLock(
    getApprovedExecutionPlanLockTarget(planId),
    async () =>
      saveApprovedExecutionPlanFile({
        planId,
        state: {
          status: 'prepared',
          simulationCount: 0,
          createdAt: payload.createdAt,
        },
        payload,
      })
  );
}

export async function loadApprovedExecutionPlan(
  planId: string
): Promise<ApprovedExecutionPlanFile> {
  const path =
    getApprovedExecutionPlanPath(planId);

  const content = await readFile(
    path,
    'utf8'
  );

  /*
   * Parsed shape from disk — could be v1 or v2. We use
   * a broad type here (not ApprovedExecutionPlanFile)
   * because the in-memory type now has version: 2 only.
   */
  const parsed = JSON.parse(content) as {
    version?: unknown;
    planId?: unknown;
    state?: unknown;
    payload?: unknown;
    sha256?: unknown;
  };

  if (
    (parsed.version !== 1 &&
      parsed.version !== 2) ||
    typeof parsed.planId !== 'string' ||
    !parsed.state ||
    !parsed.payload ||
    typeof parsed.sha256 !== 'string'
  ) {
    throw new Error(
      'Approved execution plan has an unsupported format'
    );
  }

  /*
   * Verify the hash using the file's on-disk version.
   * v1 and v2 hashes differ because the version field
   * is part of the hashed content. The explicit branch
   * makes future schema changes safer — adding a v3
   * only requires adding a new else-if branch here.
   */
  let expectedHash: string;

  if (parsed.version === 1) {
    expectedHash = hashV1PlanContent({
      version: 1,
      planId: parsed.planId,
      state: parsed.state as ApprovedExecutionPlanState,
      payload:
        parsed.payload as ApprovedExecutionPlanPayload,
    });
  } else {
    expectedHash = hashV2PlanContent({
      version: 2,
      planId: parsed.planId,
      state: parsed.state as ApprovedExecutionPlanState,
      payload:
        parsed.payload as ApprovedExecutionPlanPayload,
    });
  }

  if (expectedHash !== parsed.sha256) {
    throw new Error(
      'Approved execution plan hash mismatch'
    );
  }

  if (parsed.planId !== planId) {
    throw new Error(
      'Approved execution plan ID mismatch'
    );
  }

  return normalizePlanFile({
    version: parsed.version as 1 | 2,
    planId: parsed.planId,
    state: parsed.state as ApprovedExecutionPlanState,
    payload:
      parsed.payload as ApprovedExecutionPlanPayload,
    sha256: parsed.sha256,
  });
}

export async function deleteApprovedExecutionPlan(
  planId: string,
  options: {
    reason?: string;
    recordTombstone?: boolean;
    allowCorruptDelete?: boolean;
  } = {}
): Promise<void> {
  const {
    reason = 'manual-delete',
    recordTombstone = true,
    allowCorruptDelete = false,
  } = options;

  /*
   * Lock so a concurrent simulate/cancel cannot race with
   * a delete. The lock file itself is not removed by rm().
   */
  await withFileLock(
    getApprovedExecutionPlanLockTarget(planId),
    async () => {
      let file:
        | ApprovedExecutionPlanFile
        | null = null;

      if (recordTombstone) {
        try {
          file =
            await loadApprovedExecutionPlan(
              planId
            );
        } catch {
          /*
           * Plan cannot be loaded (corrupt, missing,
           * hash mismatch). Do NOT silently delete —
           * quarantine unless explicitly authorized.
           */
          if (
            !allowCorruptDelete
          ) {
            throw new Error(
              'Refusing to delete an invalid plan without explicit authorization'
            );
          }

          /*
           * Caller explicitly authorized corrupt
           * deletion. Delete without a tombstone.
           */
          const path =
            getApprovedExecutionPlanPath(
              planId
            );

          await rm(path, {
            force: true,
          });

          return;
        }

        /*
         * Plan loaded successfully. Prepare the crash-
         * consistent deletion journal. This transitions
         * through pending → ledger-recorded → committed
         * under the ledger lock. Only a committed journal
         * permits removal of the plan file.
         *
         * This is fail-closed: if the journal write,
         * ledger append, or audit fails (disk full,
         * permissions, etc.), the deletion is aborted
         * and the plan remains on disk.
         */
        const {
          preparePlanDeletion,
        } = await import(
          './plan-audit.js'
        );

        const journal =
          await preparePlanDeletion(
            file,
            reason
          );

        if (
          journal.status !== 'committed'
        ) {
          throw new Error(
            `Plan deletion transaction is not committed (status: ${journal.status})`
          );
        }

        /*
         * Journal is committed — safe to remove the
         * plan file. If rm fails here, recovery can
         * detect the committed journal + existing plan
         * and retry the removal.
         */
      }

      const path =
        getApprovedExecutionPlanPath(planId);

      await rm(path, {
        force: true,
      });
    }
  );
}

export async function markApprovedExecutionPlanSimulated(
  planId: string,
  result: string
): Promise<ApprovedExecutionPlanFile> {
  /*
   * Atomic load + check + write under a per-plan lock so two
   * concurrent simulate processes cannot both pass the
   * `status === 'prepared'` gate and double-mark the plan.
   */
  return withFileLock(
    getApprovedExecutionPlanLockTarget(planId),
    async () => {
      const file =
        await loadApprovedExecutionPlan(
          planId
        );

      if (file.state.status !== 'prepared') {
        throw new Error(
          `Approved execution plan is not reusable; current status is ${file.state.status}`
        );
      }

      return saveApprovedExecutionPlanFile({
        planId: file.planId,
        state: {
          ...file.state,
          status: 'simulated',
          simulationCount:
            file.state.simulationCount + 1,
          simulatedAt:
            new Date().toISOString(),
          lastSimulationResult: result,
        },
        payload: file.payload,
      });
    }
  );
}

/**
 * Two-phase simulation receipt commit.
 *
 * Phase 1 (caller, outside lock):
 *   - Load the prepared plan
 *   - Capture its SHA-256
 *   - Build + simulate the transaction
 *   - Construct the SimulationReceipt
 *
 * Phase 2 (this function, under lock):
 *   - Reload the plan
 *   - Verify status is still 'prepared'
 *   - Verify current SHA-256 === captured SHA-256
 *   - Save the receipt and transition to 'simulated'
 *
 * This prevents a long RPC request from blocking cancellation
 * while still preventing stale simulation results from being
 * committed.
 *
 * Fail-closed rules enforced here:
 *   - status must be 'prepared' (not already simulated/cancelled)
 *   - current SHA-256 must match the captured pre-simulation SHA-256
 *   - receipt.err must be null (simulation succeeded)
 *   - receipt.walletPublicKey must match the plan's wallet
 *   - receipt.expectedCluster must match the plan's cluster
 */
export async function commitSimulationReceipt(
  planId: string,
  receipt: SimulationReceipt
): Promise<ApprovedExecutionPlanFile> {
  return withFileLock(
    getApprovedExecutionPlanLockTarget(planId),
    async () => {
      const file =
        await loadApprovedExecutionPlan(
          planId
        );

      if (file.state.status !== 'prepared') {
        throw new Error(
          `Approved execution plan is not reusable; current status is ${file.state.status}`
        );
      }

      if (file.sha256 !== receipt.planSha256BeforeSimulation) {
        throw new Error(
          'Approved execution plan changed between simulation and commit'
        );
      }

      if (receipt.err !== null) {
        throw new Error(
          'Simulation returned an error — refusing to commit receipt'
        );
      }

      /*
       * Verify the receipt's simulatedAt is not stale
       * or in the future. This prevents an old receipt
       * from being committed long after the simulation.
       */
      const simulatedAtMs = Date.parse(
        receipt.simulatedAt
      );

      if (!Number.isFinite(simulatedAtMs)) {
        throw new Error(
          'Receipt simulatedAt is invalid'
        );
      }

      const nowMs = Date.now();

      if (simulatedAtMs > nowMs) {
        throw new Error(
          'Receipt simulatedAt is in the future'
        );
      }

      const maxAgeMs =
        config.maxApprovedExecutionPlanAgeSeconds *
        1_000;

      if (nowMs - simulatedAtMs > maxAgeMs) {
        throw new Error(
          'Receipt simulatedAt is too old'
        );
      }

      if (
        receipt.walletPublicKey !==
        file.payload.walletPublicKey
      ) {
        throw new Error(
          'Receipt wallet does not match plan wallet'
        );
      }

      if (
        receipt.expectedCluster !==
        file.payload.expectedCluster
      ) {
        throw new Error(
          'Receipt cluster does not match plan cluster'
        );
      }

      return saveApprovedExecutionPlanFile({
        planId: file.planId,
        state: {
          ...file.state,
          status: 'simulated',
          simulationCount:
            file.state.simulationCount + 1,
          simulatedAt:
            receipt.simulatedAt,
          lastSimulationResult: 'DRY_RUN',
          simulationReceipt: receipt,
        },
        payload: file.payload,
      });
    }
  );
}

export async function cancelApprovedExecutionPlan(
  planId: string,
  reason: string
): Promise<ApprovedExecutionPlanFile> {
  const cleanReason =
    reason.trim();

  if (!cleanReason) {
    throw new Error(
      'Cancellation reason is required'
    );
  }

  /*
   * Atomic load + check + write under a per-plan lock. Only
   * `prepared` plans can be cancelled — a simulated or
   * already-cancelled plan is rejected so the lifecycle
   * graph stays strict: prepared -> simulated | cancelled.
   */
  return withFileLock(
    getApprovedExecutionPlanLockTarget(planId),
    async () => {
      const file =
        await loadApprovedExecutionPlan(
          planId
        );

      if (file.state.status !== 'prepared') {
        throw new Error(
          `Approved execution plan is not reusable; current status is ${file.state.status}`
        );
      }

      return saveApprovedExecutionPlanFile({
        planId: file.planId,
        state: {
          ...file.state,
          status: 'cancelled',
          cancelledAt:
            new Date().toISOString(),
          cancellationReason:
            cleanReason,
        },
        payload: file.payload,
      });
    }
  );
}

export interface MigrationResult {
  planId: string;
  migrated: boolean;
  fromVersion: 1 | 2;
  toVersion: 2;
}

/**
 * Migrate a plan file from v1 to v2 by re-saving it with
 * version: 2. The v2 hash is computed over the new shape.
 *
 * If the plan is already v2 on disk, this is a no-op that
 * returns { migrated: false }. Otherwise it re-saves the
 * file under a per-plan lock and returns { migrated: true }.
 *
 * Note: normal transitions (simulate, cancel) also upgrade
 * to v2 automatically since saveApprovedExecutionPlanFile
 * always writes version: 2. This function is for migrating
 * idle plans that haven't been touched since the v2 bump.
 */
export async function migrateApprovedExecutionPlan(
  planId: string
): Promise<MigrationResult> {
  /*
   * Entire migration happens inside the lock so the
   * returned result accurately reflects what happened
   * under the lock. The previous implementation loaded
   * outside the lock, then re-loaded inside — if another
   * process migrated the plan between the outer load and
   * the lock acquisition, the outer function would still
   * report migrated: true based on the stale outer load.
   */
  return withFileLock(
    getApprovedExecutionPlanLockTarget(planId),
    async () => {
      const current =
        await loadApprovedExecutionPlan(planId);

      if (current.diskVersion === 2) {
        return {
          planId,
          migrated: false,
          fromVersion: 2,
          toVersion: 2,
        };
      }

      await saveApprovedExecutionPlanFile({
        planId: current.planId,
        state: current.state,
        payload: current.payload,
      });

      return {
        planId,
        migrated: true,
        fromVersion: current.diskVersion,
        toVersion: 2,
      };
    }
  );
}

export function validateApprovedExecutionPlanAge(
  file: ApprovedExecutionPlanFile,
  nowMs: number = Date.now()
): void {
  const createdAtMs = Date.parse(
    file.payload.createdAt
  );

  if (!Number.isFinite(createdAtMs)) {
    throw new Error(
      'Approved execution plan createdAt is invalid'
    );
  }

  const ageMs =
    nowMs - createdAtMs;

  const maxAgeMs =
    config.maxApprovedExecutionPlanAgeSeconds *
    1_000;

  if (ageMs < 0) {
    throw new Error(
      'Approved execution plan time is in the future'
    );
  }

  if (ageMs > maxAgeMs) {
    throw new Error(
      [
        'Approved execution plan is too old.',
        `AgeMs: ${ageMs}.`,
        `MaxAgeMs: ${maxAgeMs}.`,
      ].join(' ')
    );
  }
}

/**
 * Enumerate all approved execution plan files on disk.
 *
 * Reads the plan directory, filters for `*.json` files (excluding
 * transient `*.json.lock` and `*.json.tmp` artifacts), and loads
 * each via loadApprovedExecutionPlan. Files that fail to load
 * (corrupt, in-progress write, hash mismatch) are silently skipped
 * — callers that need to see those should use
 * scanApprovedExecutionPlans instead.
 *
 * Returns files sorted by createdAt ascending (oldest first) so
 * prune callers naturally process the oldest plans first.
 */
export async function listApprovedExecutionPlans(): Promise<
  ApprovedExecutionPlanFile[]
> {
  const { valid } =
    await scanApprovedExecutionPlans();

  return valid;
}

export interface InvalidApprovedExecutionPlan {
  planId: string;
  path: string;
  error: string;
}

export interface PlanScanResult {
  valid: ApprovedExecutionPlanFile[];
  invalid: InvalidApprovedExecutionPlan[];
}

/**
 * Scan the plan directory and return both valid and invalid plans.
 *
 * Unlike listApprovedExecutionPlans, this does NOT silently skip
 * files that fail to load — each failure is captured with its
 * planId, path, and error message so operator CLIs can surface
 * corrupt/tampered/partial-write files for investigation.
 *
 * Valid plans are sorted by createdAt ascending (oldest first).
 * Invalid plans are sorted by planId for stable display.
 */
export async function scanApprovedExecutionPlans(): Promise<PlanScanResult> {
  let entries: string[];

  try {
    entries = await readdir(
      config.approvedExecutionPlanDir
    );
  } catch {
    return {
      valid: [],
      invalid: [],
    };
  }

  const planFiles = entries.filter(
    (name) =>
      name.endsWith('.json') &&
      !name.endsWith('.lock') &&
      !name.endsWith('.tmp')
  );

  const valid: ApprovedExecutionPlanFile[] =
    [];
  const invalid: InvalidApprovedExecutionPlan[] =
    [];

  for (const name of planFiles) {
    const planId = name.slice(
      0,
      -'.json'.length
    );

    try {
      const file =
        await loadApprovedExecutionPlan(
          planId
        );

      valid.push(file);
    } catch (error) {
      invalid.push({
        planId,
        path: getApprovedExecutionPlanPath(
          planId
        ),
        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  valid.sort((a, b) => {
    const aMs = Date.parse(
      a.payload.createdAt
    );
    const bMs = Date.parse(
      b.payload.createdAt
    );

    return aMs - bMs;
  });

  invalid.sort((a, b) =>
    a.planId.localeCompare(b.planId)
  );

  return { valid, invalid };
}

export interface PruneResult {
  planId: string;
  previousStatus:
    | 'prepared'
    | 'simulated'
    | 'cancelled';
  reason: 'expired' | 'finished';
  ageMs: number;
}

/**
 * Prune approved execution plans that are expired or (optionally)
 * finished.
 *
 * - `prepared` plans older than `config.maxApprovedExecutionPlanAgeSeconds`
 *   are pruned with reason `'expired'`. This is always-on and mirrors
 *   the validateApprovedExecutionPlanAge threshold.
 * - `simulated` and `cancelled` plans are pruned with reason
 *   `'finished'` only when `alsoPruneFinishedAfterMs` is provided.
 *   The age is measured from `state.simulatedAt` / `state.cancelledAt`
 *   respectively (falling back to `state.createdAt` if the transition
 *   timestamp is missing).
 *
 * This function is side-effect-free except for file deletion — it
 * does NOT audit. Callers (CLIs) own the audit trail so they can
 * batch-emit `plan-pruned` events with full context.
 *
 * Returns the list of pruned plan results for the caller to audit
 * and report.
 */
export async function pruneApprovedExecutionPlans(
  options: {
    nowMs?: number;
    alsoPruneFinishedAfterMs?: number;
    dryRun?: boolean;
  } = {}
): Promise<PruneResult[]> {
  const nowMs =
    options.nowMs ?? Date.now();

  const plans =
    await listApprovedExecutionPlans();

  const results: PruneResult[] = [];

  const maxPreparedAgeMs =
    config.maxApprovedExecutionPlanAgeSeconds *
    1_000;

  for (const plan of plans) {
    const status = plan.state.status;

    let shouldPrune = false;
    let reason: PruneResult['reason'] =
      'expired';
    let ageMs = 0;

    if (status === 'prepared') {
      const createdAtMs = Date.parse(
        plan.payload.createdAt
      );

      ageMs = nowMs - createdAtMs;

      if (ageMs > maxPreparedAgeMs) {
        shouldPrune = true;
        reason = 'expired';
      }
    } else {
      /*
       * Simulated or cancelled — only prune if the caller
       * opted in via alsoPruneFinishedAfterMs.
       */
      if (
        options.alsoPruneFinishedAfterMs !==
        undefined
      ) {
        const transitionAtStr =
          status === 'simulated'
            ? plan.state.simulatedAt
            : plan.state.cancelledAt;

        const transitionAtMs = transitionAtStr
          ? Date.parse(transitionAtStr)
          : Date.parse(
              plan.state.createdAt
            );

        ageMs = nowMs - transitionAtMs;

        if (
          ageMs >
          options.alsoPruneFinishedAfterMs
        ) {
          shouldPrune = true;
          reason = 'finished';
        }
      }
    }

    if (!shouldPrune) continue;

    /*
     * In dry-run mode, compute the candidate but do NOT
     * delete. Callers (CLIs) use this to preview exactly
     * which plans would be removed before committing.
     */
    if (!options.dryRun) {
      await deleteApprovedExecutionPlan(
        plan.planId,
        {
          reason: `pruned:${reason}`,
        }
      );
    }

    results.push({
      planId: plan.planId,
      previousStatus: status,
      reason,
      ageMs,
    });
  }

  return results;
}
