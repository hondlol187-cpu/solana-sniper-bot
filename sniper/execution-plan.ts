import {
  createHash,
  randomUUID,
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

import {
  MessageV0,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';

import type {
  AddressLookupTableAccount,
} from '@solana/web3.js';

import type {
  SimulationArtifactRpc,
} from './simulation-artifact-rpc.js';

import type {
  ApprovedTransactionPolicy,
} from './transaction-manifest.js';

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

  /*
   * Optional transaction policy snapshot.
   * Included in the plan hash when present.
   * New plans should include this; old plans
   * will have it as undefined (assessTransactionManifest
   * falls back to a safe default allowlist).
   */
  transactionPolicy?: ApprovedTransactionPolicy;
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

  /*
   * RPC-backed verification evidence.
   *
   * Optional so receipts written by older versions
   * continue to load.
   */
  verifiedAtSlot?: number;
  verifiedAtBlockHeight?: number;
  addressLookupTablesSha256?: string;

  /*
   * Transaction manifest evidence.
   * Internally computed — the caller cannot
   * supply these hashes.
   */
  transactionManifestSha256?: string;
  invokedProgramIds?: string[];
  writableAccountsSha256?: string;
  instructionDataSha256?: string;
  transactionPolicyOk?: boolean;
  transactionPolicySha256?: string;

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
 * Current in-memory plan file shape. `version` is always 3
 * (the current schema) for normalized in-memory objects.
 * `diskVersion` records which schema version was on disk when
 * the file was loaded — it may be 1 or 2 for legacy files that
 * haven't been migrated or rewritten yet.
 *
 * v3 adds `planInstanceId` — a random UUID generated at plan
 * creation time that uniquely identifies the physical plan
 * instance. This is used to derive the deletionId so that
 * recreated plans (same planId, different sha256) get their
 * own deletion transaction.
 *
 * On-disk files do NOT carry a `diskVersion` field; only
 * `version` (1, 2, or 3) is written to disk. `diskVersion`
 * is an in-memory-only annotation for migration/audit logic.
 */
export interface ApprovedExecutionPlanFile {
  version: 3;
  diskVersion: 1 | 2 | 3;
  planId: string;
  planInstanceId: string;
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
    version: 1 | 2 | 3;
    planId: string;
    planInstanceId?: string;
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

function hashV3PlanContent(
  input: {
    version: 3;
    planId: string;
    planInstanceId: string;
    state: ApprovedExecutionPlanState;
    payload: ApprovedExecutionPlanPayload;
  }
): string {
  return hashPlanContent(input);
}

/**
 * Normalize a parsed on-disk file (v1, v2, or v3) into the
 * current in-memory shape. `version` is always 3 (the current
 * schema); `diskVersion` preserves the on-disk version so
 * migration/audit logic can detect legacy files.
 *
 * v1 and v2 files don't have planInstanceId — a synthetic
 * one is generated from the planId + sha256 so legacy files
 * can still be deleted via the journal system. Migration to
 * v3 replaces this with a proper random UUID.
 */
function normalizePlanFile(
  parsed: {
    version: 1 | 2 | 3;
    planId: string;
    planInstanceId?: string;
    state: ApprovedExecutionPlanState;
    payload: ApprovedExecutionPlanPayload;
    sha256: string;
  }
): ApprovedExecutionPlanFile {
  const planInstanceId =
    parsed.planInstanceId ??
    /*
     * Legacy v1/v2 files don't have planInstanceId.
     * Synthesize one deterministically from planId +
     * sha256 so the journal system works. Migration
     * to v3 replaces this with a random UUID.
     */
    createHash('sha256')
      .update(
        `legacy-instance:${parsed.planId}:${parsed.sha256}`
      )
      .digest('hex')
      .slice(0, 32);

  return {
    version: 3,
    diskVersion: parsed.version,
    planId: parsed.planId,
    planInstanceId,
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
 * `version: 3` and computes the v3 hash — the caller does
 * not pass a version field. This is the single chokepoint
 * that enforces "all new writes are v3".
 */
async function saveApprovedExecutionPlanFile(
  file: {
    planId: string;
    planInstanceId: string;
    state: ApprovedExecutionPlanState;
    payload: ApprovedExecutionPlanPayload;
  }
): Promise<ApprovedExecutionPlanFile> {
  await ensurePlanDirectory();

  const onDiskContent = {
    version: 3 as const,
    planId: file.planId,
    planInstanceId:
      file.planInstanceId,
    state: file.state,
    payload: file.payload,
  };

  const sha256 =
    hashV3PlanContent(onDiskContent);

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
    version: 3,
    diskVersion: 3,
    planId: complete.planId,
    planInstanceId:
      complete.planInstanceId,
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
        planInstanceId:
          randomUUID(),
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
   * Parsed shape from disk — could be v1, v2, or v3. We use
   * a broad type here (not ApprovedExecutionPlanFile)
   * because the in-memory type now has version: 3 only.
   */
  const parsed = JSON.parse(content) as {
    version?: unknown;
    planId?: unknown;
    planInstanceId?: unknown;
    state?: unknown;
    payload?: unknown;
    sha256?: unknown;
  };

  if (
    (parsed.version !== 1 &&
      parsed.version !== 2 &&
      parsed.version !== 3) ||
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
   * v1, v2, and v3 hashes differ because the version
   * field (and planInstanceId for v3) is part of the
   * hashed content. The explicit branch makes future
   * schema changes safer — adding a v4 only requires
   * adding a new else-if branch here.
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
  } else if (parsed.version === 2) {
    expectedHash = hashV2PlanContent({
      version: 2,
      planId: parsed.planId,
      state: parsed.state as ApprovedExecutionPlanState,
      payload:
        parsed.payload as ApprovedExecutionPlanPayload,
    });
  } else {
    /*
     * v3 requires planInstanceId in the hashed content.
     */
    if (
      typeof parsed.planInstanceId !==
      'string'
    ) {
      throw new Error(
        'Approved execution plan v3 is missing planInstanceId'
      );
    }

    expectedHash = hashV3PlanContent({
      version: 3,
      planId: parsed.planId,
      planInstanceId:
        parsed.planInstanceId,
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
    version: parsed.version as 1 | 2 | 3,
    planId: parsed.planId,
    planInstanceId:
      typeof parsed.planInstanceId ===
      'string'
        ? parsed.planInstanceId
        : undefined,
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


/**
 * Input for the trusted simulation artifact commit.
 *
 * The caller supplies raw transaction bytes and the
 * raw simulation response. This function deserializes
 * the transaction, recomputes all hashes, verifies
 * the transaction against the plan, and constructs
 * the SimulationReceipt internally — the caller cannot
 * supply pre-computed hashes.
 */
export interface SimulationArtifactReturnData {
  programId: string;
  data: [string, string];
}

export interface SimulationArtifactInput {
  planId: string;
  planSha256BeforeSimulation: string;
  serializedTransaction: Buffer;

  simulationResponse: {
    contextSlot: number;
    err: unknown | null;
    logs?: string[];
    unitsConsumed?: number;
    returnData?:
      SimulationArtifactReturnData;
  };

  /*
   * This must be a credential-free label, not a private
   * RPC URL containing path or query credentials.
   */
  rpcEndpoint: string;

  simulatedAt: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
}

interface ResolvedTransactionAccounts {
  accountKeys: string[];
  addressLookupTablesSha256?: string;
}

interface CanonicalLookupEvidence {
  tableAddress: string;
  writable: Array<{
    index: number;
    address: string;
  }>;
  readonly: Array<{
    index: number;
    address: string;
  }>;
}

function assertSafeNonNegativeInteger(
  value: number,
  label: string
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error(
      `${label} is invalid`
    );
  }
}

function resolveLookupAddress(
  table: AddressLookupTableAccount,
  index: number,
  kind: 'writable' | 'readonly'
): PublicKey {
  assertSafeNonNegativeInteger(
    index,
    `Address lookup table ${kind} index`
  );

  const address =
    table.state.addresses[index];

  if (!address) {
    throw new Error(
      [
        `Address lookup table ${table.key.toBase58()}`,
        `has an out-of-range ${kind} index ${index}`,
      ].join(' ')
    );
  }

  return address;
}

async function resolveTransactionAccounts(
  transaction: VersionedTransaction,
  rpc: SimulationArtifactRpc
): Promise<ResolvedTransactionAccounts> {
  /*
   * Legacy messages and v0 messages without lookup
   * tables need only their static keys.
   */
  if (transaction.version !== 0) {
    return {
      accountKeys:
        transaction.message
          .staticAccountKeys
          .map((key) =>
            key.toBase58()
          ),
    };
  }

  const message =
    transaction.message as MessageV0;

  if (
    message.addressTableLookups
      .length === 0
  ) {
    return {
      accountKeys:
        message.staticAccountKeys.map(
          (key) => key.toBase58()
        ),
    };
  }

  const lookupTableAccounts:
    AddressLookupTableAccount[] = [];

  const canonicalEvidence:
    CanonicalLookupEvidence[] = [];

  for (
    const lookup of
    message.addressTableLookups
  ) {
    let table:
      | AddressLookupTableAccount
      | null;

    try {
      table =
        await rpc
          .loadAddressLookupTable(
            lookup.accountKey
          );
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : String(error);

      throw new Error(
        [
          'Failed to load address lookup table',
          lookup.accountKey.toBase58(),
          detail,
        ].join(': ')
      );
    }

    if (!table) {
      throw new Error(
        `Address lookup table ${lookup.accountKey.toBase58()} does not exist`
      );
    }

    if (
      !table.key.equals(
        lookup.accountKey
      )
    ) {
      throw new Error(
        'Loaded address lookup table key does not match transaction lookup'
      );
    }

    const writable =
      Array.from(
        lookup.writableIndexes
      ).map((index) => ({
        index,
        address:
          resolveLookupAddress(
            table,
            index,
            'writable'
          ).toBase58(),
      }));

    const readonly =
      Array.from(
        lookup.readonlyIndexes
      ).map((index) => ({
        index,
        address:
          resolveLookupAddress(
            table,
            index,
            'readonly'
          ).toBase58(),
      }));

    lookupTableAccounts.push(
      table
    );

    canonicalEvidence.push({
      tableAddress:
        table.key.toBase58(),
      writable,
      readonly,
    });
  }

  let resolvedKeys;

  try {
    resolvedKeys =
      message.getAccountKeys({
        addressLookupTableAccounts:
          lookupTableAccounts,
      });
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      `Failed to resolve transaction address lookup tables: ${detail}`
    );
  }

  const accountKeys: string[] = [];

  for (
    let index = 0;
    index < resolvedKeys.length;
    index += 1
  ) {
    const key =
      resolvedKeys.get(index);

    if (!key) {
      throw new Error(
        `Resolved transaction account key ${index} is missing`
      );
    }

    accountKeys.push(
      key.toBase58()
    );
  }

  /*
   * Evidence is already in deterministic transaction order.
   * Object keys and array element order are fixed here.
   */
  const addressLookupTablesSha256 =
    createHash('sha256')
      .update(
        JSON.stringify(
          canonicalEvidence
        )
      )
      .digest('hex');

  return {
    accountKeys,
    addressLookupTablesSha256,
  };
}

/**
 * Trusted simulation artifact commit.
 *
 * The caller supplies the exact serialized transaction bytes
 * and raw simulation response. This function:
 *
 * 1. Deserializes the exact transaction bytes.
 * 2. Recomputes the serialized transaction and message hashes.
 * 3. Recomputes simulation logs and return-data hashes.
 * 4. Verifies the transaction fee payer matches the plan wallet.
 * 5. Rejects unexpected required signers.
 * 6. Resolves v0 address lookup tables through the trusted RPC.
 * 7. Verifies all approved route AMM keys occur in the complete
 *    resolved transaction account-key set.
 * 8. Verifies the simulation completed without an error.
 * 9. Verifies blockhash validity, block height, slot lag, and
 *    simulation-receipt age.
 * 10. Constructs the SimulationReceipt internally.
 * 11. Reacquires the plan lock and commits only when the plan is
 *     still prepared and its SHA-256 is unchanged.
 *
 * Maximum SOL outflow is enforced earlier by
 * simulateWithSpendGuard(). This function does not attempt to
 * decode arbitrary Jupiter instruction data or claim to enforce
 * a writable-account allowlist.
 */
export async function commitSimulationArtifact(
  input: SimulationArtifactInput,
  rpc: SimulationArtifactRpc
): Promise<ApprovedExecutionPlanFile> {
  /*
   * Phase 1: Verify + construct (outside the plan lock).
   */

  /*
   * Deserialize the transaction.
   */
  let transaction: VersionedTransaction;

  try {
    transaction =
      VersionedTransaction.deserialize(
        input.serializedTransaction
      );
  } catch {
    throw new Error(
      'Failed to deserialize simulation transaction'
    );
  }

  /*
   * Verify the recent blockhash in the input
   * matches the one embedded in the transaction
   * message. This catches a caller that supplies
   * mismatched metadata.
   */
  if (
    input.recentBlockhash !==
    transaction.message.recentBlockhash
  ) {
    throw new Error(
      'Artifact recent blockhash does not match transaction message'
    );
  }

  /*
   * Validate lastValidBlockHeight.
   */
  assertSafeNonNegativeInteger(
    input.lastValidBlockHeight,
    'Artifact lastValidBlockHeight'
  );

  /*
   * Recompute hashes from raw bytes.
   */
  const serializedTransactionSha256 =
    createHash('sha256')
      .update(
        input.serializedTransaction
      )
      .digest('hex');

  const messageBytes =
    transaction.message.serialize();
  const transactionMessageSha256 =
    createHash('sha256')
      .update(messageBytes)
      .digest('hex');

  const logsSha256 = createHash('sha256')
    .update(
      JSON.stringify(
        input.simulationResponse.logs ??
          []
      )
    )
    .digest('hex');

  const returnDataSha256 =
    input.simulationResponse.returnData
      ? createHash('sha256')
          .update(
            JSON.stringify({
              programId:
                input.simulationResponse
                  .returnData
                  .programId,
              data: [
                input.simulationResponse
                  .returnData
                  .data[0],
                input.simulationResponse
                  .returnData
                  .data[1],
              ],
            })
          )
          .digest('hex')
      : undefined;

  /*
   * Verify simulation err is null.
   */
  if (
    input.simulationResponse.err !== null
  ) {
    throw new Error(
      'Simulation returned an error — refusing to commit artifact'
    );
  }

  /*
   * Verify the fee payer equals the plan wallet.
   * We need to load the plan first to get the
   * walletPublicKey, then check the transaction's
   * static account keys (index 0 is the fee payer).
   */
  const planFile =
    await loadApprovedExecutionPlan(
      input.planId
    );

  if (
    planFile.sha256 !==
    input.planSha256BeforeSimulation
  ) {
    throw new Error(
      'Approved execution plan changed between simulation and commit'
    );
  }

  const expectedWallet =
    planFile.payload.walletPublicKey;

  const staticAccountKeys =
    transaction.message
      .staticAccountKeys;

  const feePayer =
    staticAccountKeys[0];

  if (!feePayer) {
    throw new Error(
      'Transaction has no fee payer'
    );
  }

  if (
    feePayer.toBase58() !==
    expectedWallet
  ) {
    throw new Error(
      `Transaction fee payer ${feePayer.toBase58()} does not match plan wallet ${expectedWallet}`
    );
  }

  /*
   * Reject unexpected signers. The transaction
   * should only have the fee payer as a signer
   * (or be unsigned for simulation). Any additional
   * required signers are suspicious.
   */
  const unexpectedSigners: string[] =
    [];

  for (let i = 1; i < staticAccountKeys.length; i++) {
    if (
      transaction.message.isAccountSigner(
        i
      )
    ) {
      unexpectedSigners.push(
        staticAccountKeys[i].toBase58()
      );
    }
  }

  if (unexpectedSigners.length > 0) {
    throw new Error(
      `Transaction has unexpected signers: ${unexpectedSigners.join(', ')}`
    );
  }

  /*
   * Verify the input amount equals the plan's
   * buyLamports. For SOL input, the first
   * instruction's first account should be the
   * source, and the amount is in the instruction
   * data — but we can't easily parse arbitrary
   * instruction formats here. Instead, we verify
   * the plan's quoteInAmount matches buyLamports
   * (which the prepare step already enforces).
   * The spend guard in transaction-guard.ts
   * handles the actual SOL outflow check.
   *
   * What we verify here: the canonical transaction
   * manifest is built, every instruction is checked
   * against the plan's transaction policy, and route
   * accounts must be referenced by an invoked
   * instruction (not merely present in the account list).
   */
  const {
    buildTransactionManifest,
    assessTransactionManifest,
    computeWritableAccountsSha256,
    computeInstructionDataSha256,
    validateApprovedTransactionPolicy,
    computeApprovedTransactionPolicySha256,
  } = await import(
    './transaction-manifest.js'
  );

  const transactionPolicy =
    planFile.payload
      .transactionPolicy;

  if (!transactionPolicy) {
    throw new Error(
      [
        'Approved execution plan has no transaction-policy snapshot.',
        'Re-prepare the plan before simulation.',
      ].join(' ')
    );
  }

  const policyValidation =
    validateApprovedTransactionPolicy(
      transactionPolicy,
      planFile
    );

  if (!policyValidation.ok) {
    throw new Error(
      [
        'Approved transaction policy is invalid:',
        ...policyValidation
          .reasons,
      ].join(' ')
    );
  }

  const manifest =
    await buildTransactionManifest(
      transaction,
      rpc
    );

  const policyResult =
    assessTransactionManifest(
      manifest,
      planFile
    );

  if (!policyResult.ok) {
    throw new Error(
      [
        'Transaction policy check failed:',
        ...policyResult.reasons,
      ].join(' ')
    );
  }

  const writableAccountsSha256 =
    computeWritableAccountsSha256(
      manifest
    );

  const instructionDataSha256 =
    computeInstructionDataSha256(
      manifest
    );

  /*
   * Verify the transaction against current state from
   * the same RPC connection that performed simulation.
   */
  let verifiedAtSlot: number;
  let verifiedAtBlockHeight: number;
  let blockhashValid: boolean;

  try {
    [
      verifiedAtSlot,
      verifiedAtBlockHeight,
      blockhashValid,
    ] = await Promise.all([
      rpc.getCurrentSlot(),
      rpc.getCurrentBlockHeight(),
      rpc.isRecentBlockhashValid(
        transaction.message
          .recentBlockhash
      ),
    ]);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      `Failed to verify simulation artifact against RPC state: ${detail}`
    );
  }

  assertSafeNonNegativeInteger(
    input.simulationResponse
      .contextSlot,
    'Simulation context slot'
  );

  assertSafeNonNegativeInteger(
    verifiedAtSlot,
    'RPC current slot'
  );

  assertSafeNonNegativeInteger(
    verifiedAtBlockHeight,
    'RPC current block height'
  );

  assertSafeNonNegativeInteger(
    input.lastValidBlockHeight,
    'Artifact lastValidBlockHeight'
  );

  if (!blockhashValid) {
    throw new Error(
      'Simulation transaction blockhash is no longer valid'
    );
  }

  if (
    verifiedAtBlockHeight >
    input.lastValidBlockHeight
  ) {
    throw new Error(
      [
        'Simulation transaction blockhash has expired.',
        `Current block height: ${verifiedAtBlockHeight}.`,
        `Last valid block height: ${input.lastValidBlockHeight}.`,
      ].join(' ')
    );
  }

  const contextSlot =
    input.simulationResponse
      .contextSlot;

  if (
    contextSlot >
    verifiedAtSlot
  ) {
    throw new Error(
      'Simulation context slot is ahead of RPC current slot'
    );
  }

  const slotLag =
    verifiedAtSlot -
    contextSlot;

  if (
    slotLag >
    config.maxSimulationSlotLag
  ) {
    throw new Error(
      [
        `Simulation slot ${contextSlot} is too far behind`,
        `verified RPC slot ${verifiedAtSlot}.`,
        `Lag ${slotLag} exceeds ${config.maxSimulationSlotLag}.`,
      ].join(' ')
    );
  }

  /*
   * Verify simulatedAt freshness using the
   * simulation-receipt-specific threshold.
   */
  const simulatedAtMs = Date.parse(
    input.simulatedAt
  );

  if (!Number.isFinite(simulatedAtMs)) {
    throw new Error(
      'Simulation simulatedAt is invalid'
    );
  }

  const nowMs = Date.now();

  if (simulatedAtMs > nowMs) {
    throw new Error(
      'Simulation simulatedAt is in the future'
    );
  }

  const maxReceiptAgeMs =
    config.maxSimulationReceiptAgeSeconds *
    1_000;

  if (nowMs - simulatedAtMs > maxReceiptAgeMs) {
    throw new Error(
      'Simulation simulatedAt is too old'
    );
  }

  /*
   * Construct the receipt internally.
   */
  const receipt: SimulationReceipt = {
    transactionMessageSha256,
    serializedTransactionSha256,

    recentBlockhash:
      input.recentBlockhash,

    lastValidBlockHeight:
      input.lastValidBlockHeight,

    simulatedAt:
      input.simulatedAt,

    rpcEndpoint:
      input.rpcEndpoint,

    contextSlot,
    verifiedAtSlot,
    verifiedAtBlockHeight,

    err: null,

    unitsConsumed:
      input.simulationResponse
        .unitsConsumed,

    logsSha256,

    ...(returnDataSha256
      ? { returnDataSha256 }
      : {}),

    ...(manifest.lookupTablesSha256
      ? {
          addressLookupTablesSha256:
            manifest.lookupTablesSha256,
        }
      : {}),

    transactionManifestSha256:
      manifest.manifestSha256,

    invokedProgramIds:
      policyResult.invokedProgramIds,

    writableAccountsSha256,

    instructionDataSha256,

    transactionPolicyOk:
      policyResult.ok,

    transactionPolicySha256:
      policyValidation.sha256,

    walletPublicKey:
      expectedWallet,

    expectedCluster:
      planFile.payload
        .expectedCluster,

    planSha256BeforeSimulation:
      input
        .planSha256BeforeSimulation,
  };

  /*
   * Phase 2: Reacquire the plan lock and commit.
   */
  return withFileLock(
    getApprovedExecutionPlanLockTarget(
      input.planId
    ),
    async () => {
      const file =
        await loadApprovedExecutionPlan(
          input.planId
        );

      if (
        file.state.status !== 'prepared'
      ) {
        throw new Error(
          `Approved execution plan is not reusable; current status is ${file.state.status}`
        );
      }

      if (
        file.sha256 !==
        input.planSha256BeforeSimulation
      ) {
        throw new Error(
          'Approved execution plan changed between simulation and commit'
        );
      }

      /*
       * Require policy consistency under the lock.
       */
      const lockedPolicy =
        file.payload
          .transactionPolicy;

      if (!lockedPolicy) {
        throw new Error(
          'Approved execution plan transaction policy disappeared before commit'
        );
      }

      const lockedPolicySha256 =
        computeApprovedTransactionPolicySha256(
          lockedPolicy
        );

      if (
        lockedPolicySha256 !==
        receipt
          .transactionPolicySha256
      ) {
        throw new Error(
          'Approved transaction policy changed between verification and commit'
        );
      }

      /*
       * Verify wallet and cluster match.
       */
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
        planInstanceId:
          file.planInstanceId,
        state: {
          ...file.state,
          status: 'simulated',
          simulationCount:
            file.state.simulationCount + 1,
          simulatedAt: receipt.simulatedAt,
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
        planInstanceId:
          file.planInstanceId,
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
  fromVersion: 1 | 2 | 3;
  toVersion: 3;
  planInstanceId: string;
}

/**
 * Migrate a plan file from v1/v2 to v3 by re-saving it with
 * version: 3 and a generated planInstanceId. The v3 hash is
 * computed over the new shape.
 *
 * If the plan is already v3 on disk, this is a no-op that
 * returns { migrated: false }. Otherwise it re-saves the
 * file under a per-plan lock and returns { migrated: true }.
 *
 * Note: normal transitions (simulate, cancel) also upgrade
 * to v3 automatically since saveApprovedExecutionPlanFile
 * always writes version: 3. This function is for migrating
 * idle plans that haven't been touched since the v3 bump.
 */
export async function migrateApprovedExecutionPlan(
  planId: string
): Promise<MigrationResult> {
  /*
   * Entire migration happens inside the lock so the
   * returned result accurately reflects what happened
   * under the lock.
   */
  return withFileLock(
    getApprovedExecutionPlanLockTarget(planId),
    async () => {
      const current =
        await loadApprovedExecutionPlan(planId);

      if (current.diskVersion === 3) {
        return {
          planId,
          migrated: false,
          fromVersion: 3,
          toVersion: 3,
          planInstanceId:
            current.planInstanceId,
        };
      }

      /*
       * Generate a new planInstanceId for the migrated
       * plan. Legacy v1/v2 files don't have a proper
       * random UUID (normalizePlanFile synthesizes a
       * deterministic one), so migration always assigns
       * a fresh randomUUID().
       */
      const planInstanceId =
        randomUUID();

      await saveApprovedExecutionPlanFile({
        planId: current.planId,
        planInstanceId,
        state: current.state,
        payload: current.payload,
      });

      return {
        planId,
        migrated: true,
        fromVersion: current.diskVersion,
        toVersion: 3,
        planInstanceId,
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
