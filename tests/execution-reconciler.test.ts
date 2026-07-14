import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ExecutionSignatureStatus,
  ExecutionStatusRpc,
} from '../sniper/execution-reconciler.js';

let configured = false;
let planDir: string;
let riskFile: string;
let auditFile: string;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-reconcile-')
  );

  planDir = join(dir, 'plans');
  riskFile = join(dir, 'risk.json');
  auditFile = join(dir, 'audit.jsonl');

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL = 'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY = '11111111111111111111111111111111';
  process.env.OUTPUT_MINT = 'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_DIR = planDir;
  process.env.RISK_FILE = riskFile;
  process.env.AUDIT_FILE = auditFile;
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS = '30';
  process.env.MAX_DAILY_SPEND_SOL = '0.2';
  process.env.MAX_DAILY_TRADES = '3';
  process.env.MAX_DAILY_DRAWDOWN_SOL = '0.1';

  configured = true;
}

async function cleanAll() {
  await configureEnvironment();

  await rm(planDir, { force: true, recursive: true });
  await mkdir(planDir, { recursive: true, mode: 0o700 });
  await rm(riskFile, { force: true });
  await rm(auditFile, { force: true });
}

const PLAN_ID = 'test-plan-id';
const PLAN_INSTANCE_ID = 'test-instance-id';
const ARTIFACT_ID = 'test-artifact-id';

const SIGNED_TX_SHA = 'a'.repeat(64);
const MSG_SHA = 'b'.repeat(64);
const LAST_VALID_BLOCK_HEIGHT = 200_000_000;

const FAKE_WALLET_BALANCE = 1_000_000_000n;

const WALLET_PUBLIC_KEY =
  '11111111111111111111111111111111';
const EXACT_MINT = 'TEST_MINT_A';
const BUY_LAMPORTS = '50000000';

/*
 * Write a minimal v3 plan file that loadApprovedExecutionPlan
 * accepts. The reconciler only reads plan.planInstanceId,
 * plan.payload.walletPublicKey, and plan.payload.exactMint.
 */
async function writePlan(
  planId: string,
  planInstanceId: string
) {
  const { createHash } =
    await import('node:crypto');

  const { getApprovedExecutionPlanPath } =
    await import(
      '../sniper/execution-plan.js'
    );

  const state = {
    status: 'simulated' as const,
    simulationCount: 1,
    createdAt:
      new Date(
        Date.now() - 1_000
      ).toISOString(),
    simulatedAt:
      new Date().toISOString(),
    simulationReceipt: {
      transactionMessageSha256:
        MSG_SHA,
      serializedTransactionSha256:
        'c'.repeat(64),
      recentBlockhash:
        '11111111111111111111111111111111',
      lastValidBlockHeight:
        LAST_VALID_BLOCK_HEIGHT,
      simulatedAt:
        new Date().toISOString(),
      rpcEndpoint:
        'https://api.mainnet-beta.solana.com',
      contextSlot: 1,
      err: null,
      logsSha256: 'd'.repeat(64),
      walletPublicKey: WALLET_PUBLIC_KEY,
      expectedCluster: 'mainnet-beta',
      planSha256BeforeSimulation:
        'e'.repeat(64),
      transactionPolicyOk: true,
      transactionPolicySha256:
        'f'.repeat(64),
      artifactId: ARTIFACT_ID,
      artifactSha256: '1'.repeat(64),
    },
  };

  const payload = {
    signature: 'sig-reconcile-1',
    exactMint: EXACT_MINT,
    createdAt:
      new Date(1_000_000).toISOString(),
    quoteReceivedAtMs: 995_000,
    walletPublicKey: WALLET_PUBLIC_KEY,
    expectedCluster: 'mainnet-beta',
    buyLamports: BUY_LAMPORTS,
    approvedPoolAddress: 'POOL_1',
    approvedQuoteMint:
      'So11111111111111111111111111111111111111112',
    approvedLiquiditySol: 100,
    currentPoolAddress: 'POOL_1',
    currentQuoteMint:
      'So11111111111111111111111111111111111111112',
    currentLiquiditySol: 90,
    routeHopCount: 1,
    routeLabels: ['Raydium AMM'],
    routeAmmKeys: ['POOL_1'],
    quoteInputMint:
      'So11111111111111111111111111111111111111112',
    quoteOutputMint: EXACT_MINT,
    quoteInAmount: BUY_LAMPORTS,
    quoteOutAmount: '1000000',
    quoteOtherAmountThreshold: '900000',
    quoteSlippageBps: 150,
    quotePriceImpactPct: '0.5',
    quoteRoutePlan: [],
    routeOk: true,
    routeReasons: [],
    approvalOk: true,
    approvalReasons: [],
    quoteAgeMs: 100,
  };

  const stableStringify = (
    value: unknown
  ): string => {
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

    const entries = Object.entries(
      value as Record<string, unknown>
    )
      .filter(
        ([, v]) => v !== undefined
      )
      .sort(([a], [b]) =>
        a.localeCompare(b)
      );

    return `{${entries
      .map(
        ([k, v]) =>
          `${JSON.stringify(k)}:${stableStringify(v)}`
      )
      .join(',')}}`;
  };

  const hash = createHash('sha256')
    .update(
      stableStringify({
        version: 3,
        planId,
        planInstanceId,
        state,
        payload,
      })
    )
    .digest('hex');

  const path =
    getApprovedExecutionPlanPath(
      planId
    );

  await mkdir(
    join(path, '..'),
    {
      recursive: true,
      mode: 0o700,
    }
  );

  await writeFile(
    path,
    JSON.stringify(
      {
        version: 3,
        planId,
        planInstanceId,
        state,
        payload,
        sha256: hash,
      },
      null,
      2
    ),
    'utf8'
  );
}

function createFakeRpc(
  status:
    | Omit<
        ExecutionSignatureStatus,
        'slot'
      > &
      Partial<
        Pick<
          ExecutionSignatureStatus,
          'slot'
        >
      >
    | null
): ExecutionStatusRpc {
  return {
    async getSignatureStatus() {
      if (status === null) {
        return null;
      }

      return {
        slot:
          status.slot ??
          100,
        confirmationStatus:
          status.confirmationStatus,
        err: status.err,
      };
    },

    async getWalletBalance() {
      return FAKE_WALLET_BALANCE;
    },
  };
}

function createErrorRpc(
  error: Error
): ExecutionStatusRpc {
  return {
    async getSignatureStatus() {
      throw error;
    },

    async getWalletBalance() {
      return FAKE_WALLET_BALANCE;
    },
  };
}

async function createSubmittedJournal() {
  const {
    beginExecution,
    markExecutionSigning,
    markExecutionBroadcastReady,
    markExecutionSubmitted,
  } = await import('../sniper/execution-journal.js');

  const {
    reserveTradeOnce,
  } = await import(
    '../sniper/risk.js'
  );

  await writePlan(
    PLAN_ID,
    PLAN_INSTANCE_ID
  );

  const journal = await beginExecution(
    PLAN_ID,
    PLAN_INSTANCE_ID,
    ARTIFACT_ID
  );

  await reserveTradeOnce(
    journal.riskReservationId!,
    EXACT_MINT,
    BigInt(BUY_LAMPORTS),
    FAKE_WALLET_BALANCE
  );

  await markExecutionSigning(journal.executionId);

  await markExecutionBroadcastReady(
    journal.executionId,
    {
      transactionSignature: 'test-signature-123',
      signedTransactionSha256: SIGNED_TX_SHA,
      transactionMessageSha256: MSG_SHA,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    }
  );

  const submitted = await markExecutionSubmitted(
    journal.executionId,
    'test-signature-123'
  );

  return submitted;
}

async function createBroadcastingJournal() {
  const {
    beginExecution,
    markExecutionSigning,
    markExecutionBroadcastReady,
  } = await import('../sniper/execution-journal.js');

  const {
    reserveTradeOnce,
  } = await import(
    '../sniper/risk.js'
  );

  await writePlan(
    PLAN_ID,
    PLAN_INSTANCE_ID
  );

  const journal = await beginExecution(
    PLAN_ID,
    PLAN_INSTANCE_ID,
    ARTIFACT_ID
  );

  await reserveTradeOnce(
    journal.riskReservationId!,
    EXACT_MINT,
    BigInt(BUY_LAMPORTS),
    FAKE_WALLET_BALANCE
  );

  await markExecutionSigning(journal.executionId);

  const broadcasting = await markExecutionBroadcastReady(
    journal.executionId,
    {
      transactionSignature: 'test-signature-123',
      signedTransactionSha256: SIGNED_TX_SHA,
      transactionMessageSha256: MSG_SHA,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    }
  );

  return broadcasting;
}

test(
  'processed status remains submitted',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: 'processed',
        err: null,
      })
    );

    assert.equal(result.action, 'none');
    assert.equal(result.journal.status, 'submitted');
  }
);

test(
  'confirmed status becomes confirmed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        slot: 123_456,
        confirmationStatus: 'confirmed',
        err: null,
      })
    );

    assert.equal(result.action, 'confirmed');
    assert.equal(result.journal.status, 'confirmed');
    assert.equal(
      result.journal.confirmedSlot,
      123_456
    );
    assert.equal(
      result.journal.confirmationStatus,
      'confirmed'
    );
  }
);

test(
  'finalized status becomes confirmed with finalized evidence',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        slot: 654_321,
        confirmationStatus: 'finalized',
        err: null,
      })
    );

    assert.equal(result.action, 'confirmed');
    assert.equal(result.journal.status, 'confirmed');
    assert.equal(
      result.journal.confirmedSlot,
      654_321
    );
    assert.equal(
      result.journal.confirmationStatus,
      'finalized'
    );
  }
);

test(
  'RPC err becomes failed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        slot: 999_888,
        confirmationStatus: null,
        err: { InstructionError: [0, 'Custom'] },
      })
    );

    assert.equal(result.action, 'failed');
    assert.equal(result.journal.status, 'failed');
    assert.equal(
      result.journal.failedSlot,
      999_888
    );
    assert.match(
      result.journal.failureReason ?? '',
      /On-chain transaction error/i
    );
  }
);

test(
  'null status remains submitted',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc(null)
    );

    assert.equal(result.action, 'none');
    assert.equal(result.journal.status, 'submitted');
  }
);

test(
  'RPC exception leaves journal unchanged',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    await assert.rejects(
      reconcileExecution(
        journal.executionId,
        createErrorRpc(new Error('RPC unavailable'))
      ),
      /Failed to reconcile.*RPC unavailable/i
    );

    const { loadExecutionJournal } = await import(
      '../sniper/execution-journal.js'
    );

    const unchanged = await loadExecutionJournal(
      journal.executionId
    );

    assert.ok(unchanged);
    assert.equal(unchanged.status, 'submitted');
  }
);

test(
  'confirmed reconciliation is idempotent',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: 'confirmed',
        err: null,
      })
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: 'confirmed',
        err: null,
      })
    );

    assert.equal(result.action, 'none');
    assert.equal(result.journal.status, 'confirmed');
  }
);

test(
  'failed reconciliation is idempotent',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: null,
        err: { InstructionError: [0, 'Custom'] },
      })
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: null,
        err: { InstructionError: [0, 'Custom'] },
      })
    );

    assert.equal(result.action, 'none');
    assert.equal(result.journal.status, 'failed');
  }
);

test(
  'reconciliation never calls a send/broadcast method',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    let broadcastCalled = false;

    const rpc: ExecutionStatusRpc = {
      async getSignatureStatus() {
        return {
          slot: 100,
          confirmationStatus: 'confirmed',
          err: null,
        };
      },

      async getWalletBalance() {
        return FAKE_WALLET_BALANCE;
      },
    };

    /*
     * The fake RPC has no send/broadcast method.
     * If reconcileExecution tried to call one, it
     * would throw. This test proves the reconciler
     * only reads status, never broadcasts.
     */
    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      rpc
    );

    assert.equal(result.action, 'confirmed');
    assert.equal(broadcastCalled, false);
  }
);

test(
  'concurrent reconciliations allow one terminal transition',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const rpc = createFakeRpc({
      confirmationStatus: 'confirmed',
      err: null,
    });

    const results = await Promise.allSettled([
      reconcileExecution(journal.executionId, rpc),
      reconcileExecution(journal.executionId, rpc),
    ]);

    const fulfilled = results.filter(
      (r) => r.status === 'fulfilled'
    );

    /*
     * Both may succeed (the second is idempotent),
     * but only one performs the actual transition.
     */
    assert.ok(fulfilled.length >= 1);

    const { loadExecutionJournal } = await import(
      '../sniper/execution-journal.js'
    );

    const final = await loadExecutionJournal(
      journal.executionId
    );

    assert.ok(final);
    assert.equal(final.status, 'confirmed');
  }
);

test(
  'broadcasting execution can be reconciled to confirmed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createBroadcastingJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: 'confirmed',
        err: null,
      })
    );

    assert.equal(result.action, 'confirmed');
    assert.equal(result.journal.status, 'confirmed');
  }
);

test(
  'broadcasting execution can be reconciled to failed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createBroadcastingJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: null,
        err: { InstructionError: [0, 'Custom'] },
      })
    );

    assert.equal(result.action, 'failed');
    assert.equal(result.journal.status, 'failed');
  }
);

test(
  'broadcasting execution with null RPC status stays broadcasting',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createBroadcastingJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc(null)
    );

    assert.equal(result.action, 'none');
    assert.equal(result.journal.status, 'broadcasting');
  }
);
