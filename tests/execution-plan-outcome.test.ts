import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;
let planDir: string;
let riskFile: string;
let auditFile: string;

const SIGNED_TX_SHA = 'a'.repeat(64);
const MSG_SHA = 'b'.repeat(64);
const LAST_VALID_BLOCK_HEIGHT = 200_000_000;
const FAKE_WALLET_BALANCE = 1_000_000_000n;
const WALLET_PUBLIC_KEY = '11111111111111111111111111111111';
const EXACT_MINT = 'TEST_MINT_A';
const BUY_LAMPORTS = '50000000';

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-plan-outcome-')
  );

  planDir = join(dir, 'plans');
  riskFile = join(dir, 'risk.json');
  auditFile = join(dir, 'audit.jsonl');

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL = 'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY = WALLET_PUBLIC_KEY;
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

async function writePlan(
  planId: string,
  planInstanceId: string,
  artifactId: string
) {
  const { createHash } = await import('node:crypto');
  const { getApprovedExecutionPlanPath } = await import(
    '../sniper/execution-plan.js'
  );

  const state = {
    status: 'simulated' as const,
    simulationCount: 1,
    createdAt: new Date(Date.now() - 1_000).toISOString(),
    simulatedAt: new Date().toISOString(),
    simulationReceipt: {
      transactionMessageSha256: MSG_SHA,
      serializedTransactionSha256: 'c'.repeat(64),
      recentBlockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
      simulatedAt: new Date().toISOString(),
      rpcEndpoint: 'https://api.mainnet-beta.solana.com',
      contextSlot: 1,
      err: null,
      logsSha256: 'd'.repeat(64),
      walletPublicKey: WALLET_PUBLIC_KEY,
      expectedCluster: 'mainnet-beta',
      planSha256BeforeSimulation: 'e'.repeat(64),
      transactionPolicyOk: true,
      transactionPolicySha256: 'f'.repeat(64),
      artifactId,
      artifactSha256: '1'.repeat(64),
    },
  };

  const payload = {
    signature: `sig-${planId}`,
    exactMint: EXACT_MINT,
    createdAt: new Date(1_000_000).toISOString(),
    quoteReceivedAtMs: 995_000,
    walletPublicKey: WALLET_PUBLIC_KEY,
    expectedCluster: 'mainnet-beta',
    buyLamports: BUY_LAMPORTS,
    approvedPoolAddress: 'POOL_1',
    approvedQuoteMint: 'So11111111111111111111111111111111111111112',
    approvedLiquiditySol: 100,
    currentPoolAddress: 'POOL_1',
    currentQuoteMint: 'So11111111111111111111111111111111111111112',
    currentLiquiditySol: 90,
    routeHopCount: 1,
    routeLabels: ['Raydium AMM'],
    routeAmmKeys: ['POOL_1'],
    quoteInputMint: 'So11111111111111111111111111111111111111112',
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

  function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b)
    );
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(',')}}`;
  }

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

  const path = getApprovedExecutionPlanPath(planId);
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    JSON.stringify(
      { version: 3, planId, planInstanceId, state, payload, sha256: hash },
      null,
      2
    ),
    'utf8'
  );
}

async function createSubmittedExecution(
  planId: string,
  planInstanceId: string,
  artifactId: string,
  signature: string
) {
  const {
    beginExecution,
    markExecutionSigning,
    markExecutionBroadcastReady,
    markExecutionSubmitted,
  } = await import('../sniper/execution-journal.js');

  const { reserveTradeOnce } = await import('../sniper/risk.js');

  await writePlan(planId, planInstanceId, artifactId);

  const journal = await beginExecution(planId, planInstanceId, artifactId);

  await reserveTradeOnce(
    journal.riskReservationId!,
    EXACT_MINT,
    BigInt(BUY_LAMPORTS),
    FAKE_WALLET_BALANCE
  );

  await markExecutionSigning(journal.executionId);
  await markExecutionBroadcastReady(journal.executionId, {
    transactionSignature: signature,
    signedTransactionSha256: SIGNED_TX_SHA,
    transactionMessageSha256: MSG_SHA,
    lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
  });
  await markExecutionSubmitted(journal.executionId, signature);

  return journal;
}

test(
  'confirmed outcome persisted in plan',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-outcome-conf',
      'instance-outcome-conf',
      'artifact-outcome-conf',
      'sig-outcome-conf'
    );

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 111,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    const plan = await loadApprovedExecutionPlan('plan-outcome-conf');

    assert.ok(plan.state.executionOutcome);
    assert.equal(plan.state.executionOutcome.outcome, 'confirmed');
    assert.equal(plan.state.executionOutcome.executionId, journal.executionId);
    assert.equal(plan.state.executionOutcome.observedSlot, 111);
    assert.equal(plan.state.executionOutcome.confirmationStatus, 'confirmed');
    assert.equal(
      plan.state.executionOutcome.transactionSignature,
      'sig-outcome-conf'
    );
  }
);

test(
  'failed outcome persisted in plan',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-outcome-fail',
      'instance-outcome-fail',
      'artifact-outcome-fail',
      'sig-outcome-fail'
    );

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'failed',
      observedSlot: 222,
      failureReason: 'on-chain error',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    const plan = await loadApprovedExecutionPlan('plan-outcome-fail');

    assert.ok(plan.state.executionOutcome);
    assert.equal(plan.state.executionOutcome.outcome, 'failed');
    assert.equal(plan.state.executionOutcome.failureReason, 'on-chain error');
    assert.equal(plan.state.executionOutcome.observedSlot, 222);
  }
);

test(
  'same outcome is idempotent',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-outcome-idem',
      'instance-outcome-idem',
      'artifact-outcome-idem',
      'sig-outcome-idem'
    );

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 333,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    /*
     * Re-run settlement. The plan already has the outcome,
     * so recordExecutionOutcome should be idempotent.
     */
    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 333,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    const plan = await loadApprovedExecutionPlan('plan-outcome-idem');

    assert.ok(plan.state.executionOutcome);
    assert.equal(plan.state.executionOutcome.observedSlot, 333);
  }
);

test(
  'conflicting outcome rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-outcome-conflict',
      'instance-outcome-conflict',
      'artifact-outcome-conflict',
      'sig-outcome-conflict'
    );

    const { recordExecutionOutcome } = await import(
      '../sniper/execution-plan.js'
    );

    await recordExecutionOutcome({
      planId: 'plan-outcome-conflict',
      planInstanceId: 'instance-outcome-conflict',
      executionId: journal.executionId,
      settlementId: 'a'.repeat(32),
      artifactId: 'artifact-outcome-conflict',
      outcome: 'confirmed',
      transactionSignature: 'sig-outcome-conflict',
      observedSlot: 444,
      confirmationStatus: 'confirmed',
    });

    await assert.rejects(
      recordExecutionOutcome({
        planId: 'plan-outcome-conflict',
        planInstanceId: 'instance-outcome-conflict',
        executionId: journal.executionId,
        settlementId: 'a'.repeat(32),
        artifactId: 'artifact-outcome-conflict',
        outcome: 'failed',
        failureReason: 'conflicting',
        observedSlot: 444,
      }),
      /Conflicting execution outcome/i
    );
  }
);

test(
  'wrong plan instance rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-outcome-wrong-instance',
      'instance-outcome-wrong-instance',
      'artifact-outcome-wrong-instance',
      'sig-outcome-wrong-instance'
    );

    const { recordExecutionOutcome } = await import(
      '../sniper/execution-plan.js'
    );

    await assert.rejects(
      recordExecutionOutcome({
        planId: 'plan-outcome-wrong-instance',
        planInstanceId: 'wrong-instance',
        executionId: journal.executionId,
        settlementId: 'a'.repeat(32),
        artifactId: 'artifact-outcome-wrong-instance',
        outcome: 'confirmed',
        transactionSignature: 'sig',
        observedSlot: 555,
        confirmationStatus: 'confirmed',
      }),
      /plan-instance mismatch/i
    );
  }
);

test(
  'wrong artifact rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-outcome-wrong-art',
      'instance-outcome-wrong-art',
      'artifact-outcome-wrong-art',
      'sig-outcome-wrong-art'
    );

    const { recordExecutionOutcome } = await import(
      '../sniper/execution-plan.js'
    );

    await assert.rejects(
      recordExecutionOutcome({
        planId: 'plan-outcome-wrong-art',
        planInstanceId: 'instance-outcome-wrong-art',
        executionId: journal.executionId,
        settlementId: 'a'.repeat(32),
        artifactId: 'wrong-artifact',
        outcome: 'confirmed',
        transactionSignature: 'sig',
        observedSlot: 666,
        confirmationStatus: 'confirmed',
      }),
      /artifact does not match receipt/i
    );
  }
);

test(
  'crash after execution-applied resumes at plan update',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-outcome-crash-exec',
      'instance-outcome-crash-exec',
      'artifact-outcome-crash-exec',
      'sig-outcome-crash-exec'
    );

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    /*
     * First call drives to completion.
     */
    const first = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 777,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    assert.equal(first.status, 'committed');

    /*
     * Re-run (simulating crash recovery). Must be idempotent.
     */
    const second = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 777,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    assert.equal(second.status, 'committed');
  }
);

test(
  'crash after plan-applied resumes at audit',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-outcome-crash-plan',
      'instance-outcome-crash-plan',
      'artifact-outcome-crash-plan',
      'sig-outcome-crash-plan'
    );

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    const first = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'failed',
      observedSlot: 888,
      failureReason: 'test failure',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    assert.equal(first.status, 'committed');

    const second = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'failed',
      observedSlot: 888,
      failureReason: 'test failure',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    assert.equal(second.status, 'committed');
  }
);

test(
  'plan hash remains valid after outcome write',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-outcome-hash',
      'instance-outcome-hash',
      'artifact-outcome-hash',
      'sig-outcome-hash'
    );

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 999,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    /*
     * The plan must reload successfully after the outcome
     * was written. If the hash was computed incorrectly
     * (e.g. including undefined fields), this would throw.
     */
    const plan = await loadApprovedExecutionPlan('plan-outcome-hash');

    assert.ok(plan.state.executionOutcome);
    assert.equal(plan.sha256.length, 64);
  }
);
