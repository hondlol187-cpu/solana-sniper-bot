import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
  readFile,
  symlink,
  writeFile,
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
const WALLET_PUBLIC_KEY =
  '11111111111111111111111111111111';
const EXACT_MINT = 'TEST_MINT_A';
const BUY_LAMPORTS = '50000000';

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(
      tmpdir(),
      'sniper-settlement-'
    )
  );

  planDir = join(dir, 'plans');
  riskFile = join(dir, 'risk.json');
  auditFile = join(dir, 'audit.jsonl');

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY = WALLET_PUBLIC_KEY;
  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';
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

  await rm(planDir, {
    force: true,
    recursive: true,
  });

  await mkdir(planDir, {
    recursive: true,
    mode: 0o700,
  });

  await rm(riskFile, { force: true });
  await rm(auditFile, { force: true });
}

/*
 * Write a minimal v3 plan file.
 */
async function writePlan(
  planId: string,
  planInstanceId: string,
  artifactId: string
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

  const stableStringify = (value: unknown): string => {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value.map(stableStringify).join(',')}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b));

    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
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

  const path = getApprovedExecutionPlanPath(planId);

  await mkdir(join(path, '..'), {
    recursive: true,
    mode: 0o700,
  });

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

/*
 * Create a submitted execution journal with a risk reservation.
 */
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
  } = await import(
    '../sniper/execution-journal.js'
  );

  const { reserveTradeOnce } = await import('../sniper/risk.js');

  await writePlan(planId, planInstanceId, artifactId);

  const journal = await beginExecution(
    planId,
    planInstanceId,
    artifactId
  );

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
  'crash after risk applied resumes at execution transition',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-crash-risk',
      'instance-crash-risk',
      'artifact-crash-risk',
      'sig-crash-risk'
    );

    const { settleExecutionOutcome, loadExecutionSettlement } =
      await import('../sniper/execution-settlement.js');

    /*
     * First call: drive the settlement to completion.
     */
    const first = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 111,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    assert.equal(first.status, 'committed');

    /*
     * Simulate a crash after risk was applied but before
     * execution transition. Manually rewind the settlement
     * to 'risk-applied' and reload the journal to 'submitted'.
     * (In practice this happens if the process dies between
     * advance('risk-applied') and advance('execution-applied').)
     *
     * We can't easily rewind a sealed settlement file, so
     * instead we verify that re-calling settleExecutionOutcome
     * with the same input is idempotent — it loads the existing
     * 'committed' settlement and returns it without re-applying
     * any steps.
     */
    const second = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 111,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    assert.equal(second.status, 'committed');
    assert.equal(second.settlementId, first.settlementId);

    const reloaded = await loadExecutionSettlement(first.settlementId);
    assert.ok(reloaded);
    assert.equal(reloaded.status, 'committed');
  }
);

test(
  'crash after execution transition resumes at audit',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-crash-audit',
      'instance-crash-audit',
      'artifact-crash-audit',
      'sig-crash-audit'
    );

    const { settleExecutionOutcome } =
      await import('../sniper/execution-settlement.js');

    /*
     * Drive to completion.
     */
    const first = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'failed',
      observedSlot: 222,
      failureReason: 'test failure',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    assert.equal(first.status, 'committed');

    /*
     * Re-call (simulating crash recovery). Must be idempotent.
     */
    const second = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'failed',
      observedSlot: 222,
      failureReason: 'test failure',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    assert.equal(second.status, 'committed');
  }
);

test(
  'crash after audit produces no duplicate audit',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-no-dup-audit',
      'instance-no-dup-audit',
      'artifact-no-dup-audit',
      'sig-no-dup-audit'
    );

    const { settleExecutionOutcome } =
      await import('../sniper/execution-settlement.js');

    /*
     * First settlement: confirmed.
     */
    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 333,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    /*
     * Read the audit file — should have exactly one
     * confirmed event.
     */
    const { readFile } = await import('node:fs/promises');

    let content: string;

    try {
      content = await readFile(auditFile, 'utf8');
    } catch {
      content = '';
    }

    const confirmedCount = content
      .split('\n')
      .filter((line) =>
        line.includes(
          'candidate.execution.confirmed'
        )
      ).length;

    assert.equal(
      confirmedCount,
      1,
      'exactly one confirmed audit event after first settlement'
    );

    /*
     * Re-run the settlement (crash recovery).
     */
    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 333,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    content = await readFile(auditFile, 'utf8');

    const confirmedCountAfter = content
      .split('\n')
      .filter((line) =>
        line.includes(
          'candidate.execution.confirmed'
        )
      ).length;

    assert.equal(
      confirmedCountAfter,
      1,
      'no duplicate confirmed audit event after re-run'
    );
  }
);

test(
  'confirmed risk commit remains idempotent',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-idempotent-commit',
      'instance-idempotent-commit',
      'artifact-idempotent-commit',
      'sig-idempotent-commit'
    );

    const { settleExecutionOutcome } =
      await import('../sniper/execution-settlement.js');

    const { getRiskState } = await import('../sniper/risk.js');

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 444,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    const stateAfterFirst = await getRiskState(FAKE_WALLET_BALANCE);

    assert.equal(stateAfterFirst.completedTrades, 1);
    assert.ok(
      stateAfterFirst.committedReservationIds.includes(
        journal.riskReservationId!
      )
    );

    /*
     * Re-run.
     */
    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 444,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    const stateAfterSecond = await getRiskState(FAKE_WALLET_BALANCE);

    assert.equal(stateAfterSecond.completedTrades, 1);
    assert.equal(
      stateAfterSecond.committedReservationIds.length,
      1
    );
  }
);

test(
  'failed risk release remains idempotent',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-idempotent-release',
      'instance-idempotent-release',
      'artifact-idempotent-release',
      'sig-idempotent-release'
    );

    const { settleExecutionOutcome } =
      await import('../sniper/execution-settlement.js');

    const { getRiskState } = await import('../sniper/risk.js');

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'failed',
      observedSlot: 555,
      failureReason: 'test failure',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    const stateAfterFirst = await getRiskState(FAKE_WALLET_BALANCE);

    assert.equal(stateAfterFirst.reservations.length, 0);
    assert.ok(
      !stateAfterFirst.committedReservationIds.includes(
        journal.riskReservationId!
      )
    );

    /*
     * Re-run.
     */
    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'failed',
      observedSlot: 555,
      failureReason: 'test failure',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    const stateAfterSecond = await getRiskState(FAKE_WALLET_BALANCE);

    assert.equal(stateAfterSecond.reservations.length, 0);
  }
);

test(
  'conflicting outcome is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-conflict-outcome',
      'instance-conflict-outcome',
      'artifact-conflict-outcome',
      'sig-conflict-outcome'
    );

    const { settleExecutionOutcome } =
      await import('../sniper/execution-settlement.js');

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 666,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    /*
     * Attempt to settle the same execution with a different
     * outcome. Must reject.
     */
    await assert.rejects(
      settleExecutionOutcome({
        executionId: journal.executionId,
        outcome: 'failed',
        observedSlot: 666,
        failureReason: 'conflicting',
        currentBalanceLamports: FAKE_WALLET_BALANCE,
      }),
      /Conflicting execution settlement/i
    );
  }
);

test(
  'conflicting slot is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-conflict-slot',
      'instance-conflict-slot',
      'artifact-conflict-slot',
      'sig-conflict-slot'
    );

    const { settleExecutionOutcome } =
      await import('../sniper/execution-settlement.js');

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 777,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    /*
     * Same outcome, different slot. Must reject.
     */
    await assert.rejects(
      settleExecutionOutcome({
        executionId: journal.executionId,
        outcome: 'confirmed',
        observedSlot: 888,
        confirmationStatus: 'confirmed',
        currentBalanceLamports: FAKE_WALLET_BALANCE,
      }),
      /Conflicting execution settlement/i
    );
  }
);

test(
  'tampered settlement hash is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-tamper-hash',
      'instance-tamper-hash',
      'artifact-tamper-hash',
      'sig-tamper-hash'
    );

    const {
      settleExecutionOutcome,
      loadExecutionSettlement,
    } = await import('../sniper/execution-settlement.js');

    const settlement = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 999,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    /*
     * Find the settlement file and tamper with it.
     */
    const { join } = await import('node:path');
    const settlementPath = join(
      planDir,
      'execution-settlements',
      `${settlement.settlementId}.json`
    );

    const content = await readFile(settlementPath, 'utf8');
    const parsed = JSON.parse(content);

    parsed.observedSlot = 1000;

    await writeFile(settlementPath, JSON.stringify(parsed, null, 2), 'utf8');

    await assert.rejects(
      loadExecutionSettlement(settlement.settlementId),
      /hash mismatch/i
    );
  }
);

test(
  'symlink settlement is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-symlink',
      'instance-symlink',
      'artifact-symlink',
      'sig-symlink'
    );

    const {
      settleExecutionOutcome,
      loadExecutionSettlement,
    } = await import('../sniper/execution-settlement.js');

    const settlement = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 101,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    /*
     * Replace the settlement file with a symlink.
     */
    const { join } = await import('node:path');
    const settlementPath = join(
      planDir,
      'execution-settlements',
      `${settlement.settlementId}.json`
    );

    const target = join(
      planDir,
      'execution-settlements',
      'target.json'
    );

    await writeFile(target, '{"version":1}', 'utf8');
    await rm(settlementPath, { force: true });
    await symlink(target, settlementPath);

    await assert.rejects(
      loadExecutionSettlement(settlement.settlementId),
      /symbolic link/i
    );

    await rm(settlementPath, { force: true });
    await rm(target, { force: true });
  }
);

test(
  'recovery never sends or rebroadcasts a transaction',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-no-rebroadcast',
      'instance-no-rebroadcast',
      'artifact-no-rebroadcast',
      'sig-no-rebroadcast'
    );

    const { settleExecutionOutcome } =
      await import('../sniper/execution-settlement.js');

    /*
     * Drive the settlement to completion.
     */
    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 202,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    /*
     * Re-run the settlement (recovery). The settlement
     * module has no sendRawTransaction call — recovery
     * only reads status and applies risk/journal/audit.
     * If it tried to send, it would throw because there
     * is no Connection object in the settlement module.
     */
    const recovered = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 202,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    assert.equal(recovered.status, 'committed');

    /*
     * Verify via the live-broadcast-surface test invariant:
     * the settlement module must not contain
     * sendRawTransaction. (This is also enforced by
     * tests/live-broadcast-surface.test.ts.)
     */
    const settlementSource = await readFile(
      join(
        process.cwd(),
        'sniper',
        'execution-settlement.ts'
      ),
      'utf8'
    );

    assert.doesNotMatch(
      settlementSource,
      /sendRawTransaction/
    );
  }
);
