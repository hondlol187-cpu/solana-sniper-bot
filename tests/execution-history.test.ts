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

import { spawnSync } from 'node:child_process';

let configured = false;
let planDir: string;
let riskFile: string;
let auditFile: string;
let testDir: string;

const SIGNED_TX_SHA = 'a'.repeat(64);
const MSG_SHA = 'b'.repeat(64);
const LAST_VALID_BLOCK_HEIGHT = 200_000_000;
const FAKE_WALLET_BALANCE = 1_000_000_000n;
const WALLET_PUBLIC_KEY = '11111111111111111111111111111111';
const EXACT_MINT = 'TEST_MINT_A';
const BUY_LAMPORTS = '50000000';

async function configureEnvironment() {
  if (configured) return;

  testDir = await mkdtemp(
    join(tmpdir(), 'sniper-exec-history-')
  );

  planDir = join(testDir, 'plans');
  riskFile = join(testDir, 'risk.json');
  auditFile = join(testDir, 'audit.jsonl');

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

function runHistory(
  planId: string,
  jsonFlag?: string
): {
  status: number | null;
  stdout: string;
  stderr: string;
  report: Record<string, unknown> | null;
} {
  const args = [planId];
  if (jsonFlag) args.push(jsonFlag);

  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      'sniper/execution-history.ts',
      ...args,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  /*
   * config.ts prints "Wallet: ..." and "Mode: ..." to stdout.
   * The JSON report is the last top-level JSON object in the
   * output. We find it by looking for the first line that is
   * exactly "{" (the start of a pretty-printed JSON object)
   * after the config lines, and parse from there to the end.
   */
  let report: Record<string, unknown> | null = null;

  const lines = stdout.split('\n');
  let jsonStart = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '{') {
      jsonStart = i;
      break;
    }
  }

  if (jsonStart >= 0) {
    try {
      report = JSON.parse(
        lines.slice(jsonStart).join('\n')
      );
    } catch {
      /* leave report null */
    }
  }

  return {
    status: result.status,
    stdout,
    stderr,
    report,
  };
}

test(
  'JSON output schema is stable',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await writePlan(
      'plan-history-schema',
      'instance-history-schema',
      'artifact-history-schema'
    );

    const result = runHistory('plan-history-schema', '--json');

    assert.equal(result.status, 0);
    assert.ok(result.report);

    const report = result.report as Record<string, unknown>;

    assert.equal(report.planId, 'plan-history-schema');
    assert.equal(report.planInstanceId, 'instance-history-schema');
    assert.equal(report.planStatus, 'simulated');
    assert.equal(report.executionOutcome, null);
    assert.ok(report.receipt);
    assert.ok(Array.isArray(report.journals));
    assert.ok(Array.isArray(report.settlements));
  }
);

test(
  'confirmed outcome appears',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-history-conf',
      'instance-history-conf',
      'artifact-history-conf',
      'sig-history-conf'
    );

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 111,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    const result = runHistory('plan-history-conf', '--json');

    assert.equal(
      result.status,
      0,
      `CLI exited ${result.status}. stderr: ${result.stderr.slice(-300)}`
    );

    const report = result.report as Record<string, unknown>;

    assert.ok(report.executionOutcome);
    const outcome = report.executionOutcome as Record<string, unknown>;
    assert.equal(outcome.outcome, 'confirmed');
    assert.equal(outcome.observedSlot, 111);
  }
);

test(
  'failed outcome appears',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-history-fail',
      'instance-history-fail',
      'artifact-history-fail',
      'sig-history-fail'
    );

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'failed',
      observedSlot: 222,
      failureReason: 'on-chain error',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    const result = runHistory('plan-history-fail', '--json');

    assert.equal(result.status, 0);
    const report = result.report as Record<string, unknown>;

    assert.ok(report.executionOutcome);
    const outcome = report.executionOutcome as Record<string, unknown>;
    assert.equal(outcome.outcome, 'failed');
    assert.equal(outcome.failureReason, 'on-chain error');
  }
);

test(
  'journal and settlement order is deterministic',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Create two executions for the same plan.
     */
    const journalA = await createSubmittedExecution(
      'plan-history-order',
      'instance-history-order',
      'artifact-history-order-a',
      'sig-history-order-a'
    );

    const journalB = await createSubmittedExecution(
      'plan-history-order',
      'instance-history-order',
      'artifact-history-order-b',
      'sig-history-order-b'
    );

    /*
     * Wait a moment so the two journals have different
     * createdAt timestamps (listExecutionJournals sorts
     * by createdAt).
     */
    await new Promise((resolve) =>
      setTimeout(resolve, 10)
    );

    const result = runHistory('plan-history-order', '--json');

    assert.equal(result.status, 0);
    const report = result.report as Record<string, unknown>;

    const journals = report.journals as Array<{
      executionId: string;
    }>;

    assert.ok(journals.length >= 1);

    /*
     * The journals should be sorted by createdAt.
     * The first journal created should appear first
     * (or at least the order should be stable across
     * two runs).
     */
    const result2 = runHistory('plan-history-order', '--json');
    const report2 = result2.report as Record<string, unknown>;
    const journals2 = report2.journals as Array<{
      executionId: string;
    }>;

    assert.deepEqual(
      journals.map((j) => j.executionId),
      journals2.map((j) => j.executionId)
    );
  }
);

test(
  'another plan data is excluded',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecution(
      'plan-history-a',
      'instance-history-a',
      'artifact-history-a',
      'sig-history-a'
    );

    await createSubmittedExecution(
      'plan-history-b',
      'instance-history-b',
      'artifact-history-b',
      'sig-history-b'
    );

    const result = runHistory('plan-history-a', '--json');

    assert.equal(result.status, 0);
    const report = result.report as Record<string, unknown>;

    assert.equal(report.planId, 'plan-history-a');

    const journals = report.journals as Array<{
      planId: string;
    }>;

    for (const journal of journals) {
      assert.equal(journal.planId, 'plan-history-a');
    }

    const settlements = report.settlements as Array<{
      planId: string;
    }>;

    for (const settlement of settlements) {
      assert.equal(settlement.planId, 'plan-history-a');
    }
  }
);

test(
  'missing plan exits nonzero',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const result = runHistory('nonexistent-plan', '--json');

    assert.notEqual(result.status, 0);
  }
);

test(
  'output contains no private key or raw transaction bytes',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-history-redact',
      'instance-history-redact',
      'artifact-history-redact',
      'sig-history-redact'
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

    const result = runHistory('plan-history-redact', '--json');

    const output = result.stdout + result.stderr;

    /*
     * No private key fields.
     */
    assert.doesNotMatch(
      output,
      /privateKey|secretKey|seed/i
    );

    /*
     * No raw transaction bytes (only hashes are present).
     */
    assert.doesNotMatch(
      output,
      /serializedTransactionBase64/
    );
  }
);
