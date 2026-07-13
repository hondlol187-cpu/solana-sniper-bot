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
 * Current plan file shape. New writes always use version 2.
 * The on-disk version field indicates which schema the file
 * was written with — loadApprovedExecutionPlan accepts both.
 */
export interface ApprovedExecutionPlanFile {
  version: 1 | 2;
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
 * Normalize a parsed file (v1 or v2) into the current
 * in-memory shape. The version and sha256 are preserved
 * so callers can inspect the on-disk version. The state
 * is guaranteed to satisfy ApprovedExecutionPlanState
 * (v1 states are a subset — cancelledAt is simply absent).
 */
function normalizePlanFile(
  parsed: LegacyApprovedExecutionPlanFileV1 | ApprovedExecutionPlanFile
): ApprovedExecutionPlanFile {
  return {
    version: parsed.version,
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

async function saveApprovedExecutionPlanFile(
  file: Omit<ApprovedExecutionPlanFile, 'sha256'>
): Promise<ApprovedExecutionPlanFile> {
  await ensurePlanDirectory();

  const complete: ApprovedExecutionPlanFile = {
    ...file,
    sha256: hashPlanContent(file),
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

  return complete;
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
        version: 2,
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

  const parsed =
    JSON.parse(content) as Partial<ApprovedExecutionPlanFile>;

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
   * is part of the hashed content.
   */
  const contentToHash = {
    version: parsed.version as 1 | 2,
    planId: parsed.planId,
    state: parsed.state as ApprovedExecutionPlanState,
    payload: parsed.payload as ApprovedExecutionPlanPayload,
  };

  const expectedHash =
    hashPlanContent(contentToHash);

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

  return normalizePlanFile(
    parsed as
      | LegacyApprovedExecutionPlanFileV1
      | ApprovedExecutionPlanFile
  );
}

export async function deleteApprovedExecutionPlan(
  planId: string
): Promise<void> {
  /*
   * Lock so a concurrent simulate/cancel cannot race with
   * a delete. The lock file itself is not removed by rm().
   */
  await withFileLock(
    getApprovedExecutionPlanLockTarget(planId),
    async () => {
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
        version: file.version,
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
        version: file.version,
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

/**
 * Migrate a plan file from v1 to v2 by re-saving it with
 * version: 2. The v2 hash is computed over the new shape.
 *
 * If the plan is already v2, this is a no-op that returns
 * the loaded file without re-writing.
 *
 * This is the only function that upgrades the on-disk version.
 * Normal transitions (simulate, cancel) preserve the loaded
 * version so operators can migrate at their own pace.
 */
export async function migrateApprovedExecutionPlan(
  planId: string
): Promise<ApprovedExecutionPlanFile> {
  const loaded =
    await loadApprovedExecutionPlan(planId);

  if (loaded.version === 2) {
    return loaded;
  }

  return withFileLock(
    getApprovedExecutionPlanLockTarget(planId),
    async () =>
      saveApprovedExecutionPlanFile({
        version: 2,
        planId: loaded.planId,
        state: loaded.state,
        payload: loaded.payload,
      })
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
        plan.planId
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
