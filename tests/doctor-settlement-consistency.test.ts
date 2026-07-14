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
    join(tmpdir(), 'sniper-doctor-settlement-')
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
  signature: string
) {
  const {
    beginExecution,
    markExecutionSigning,
    markExecutionBroadcastReady,
    markExecutionSubmitted,
  } = await import('../sniper/execution-journal.js');

  const { reserveTradeOnce } = await import('../sniper/risk.js');

  const { persistSimulationArtifact } = await import(
    '../sniper/simulation-artifact-store.js'
  );

  const {
    VersionedTransaction,
    MessageV0,
    PublicKey,
    TransactionInstruction,
  } = await import('@solana/web3.js');

  /*
   * Create a minimal simulation artifact so the doctor's
   * loadSimulationArtifact check passes. The artifact ID is
   * derived from planInstanceId + serializedTransactionSha256.
   */
  const feePayer = new PublicKey(WALLET_PUBLIC_KEY);
  const dummyProgram = new PublicKey(
    '11111111111111111111111111111112'
  );

  const message = MessageV0.compile({
    payerKey: feePayer,
    instructions: [
      new TransactionInstruction({
        keys: [
          {
            pubkey: feePayer,
            isSigner: true,
            isWritable: true,
          },
        ],
        programId: dummyProgram,
        data: Buffer.alloc(0),
      }),
    ],
    recentBlockhash: '11111111111111111111111111111111',
    addressLookupTableAccounts: [],
  });

  const dummyTx = new VersionedTransaction(message);

  const serializedTx = Buffer.from(dummyTx.serialize());

  const storedArtifact = await persistSimulationArtifact({
    planId,
    planInstanceId,
    planSha256BeforeSimulation: 'e'.repeat(64),
    serializedTransaction: serializedTx,
    simulationResponse: {
      contextSlot: 1,
      err: null,
      logs: [],
    },
    createdAt: new Date().toISOString(),
  });

  await writePlan(planId, planInstanceId, storedArtifact.artifactId);

  const journal = await beginExecution(
    planId,
    planInstanceId,
    storedArtifact.artifactId
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

function runDoctor(): {
  status: number | null;
  stdout: string;
  stderr: string;
  report: {
    ok: boolean;
    errors: string[];
    warnings: string[];
    journalCount: number;
    settlementCount: number;
    incompleteSettlementCount: number;
  };
  settlementErrors: string[];
  settlementWarnings: string[];
} {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      'sniper/doctor-executions.ts',
      '--json',
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
    }
  );

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  /*
   * config.ts prints "Wallet: ..." and "Mode: ..." to stdout
   * on import. The JSON report starts at the last line that
   * begins with '{' and extends to the end of stdout.
   */
  const lines = stdout.split('\n');
  let jsonStart = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().startsWith('{')) {
      jsonStart = i;
      break;
    }
  }

  let report: {
    ok: boolean;
    errors: string[];
    warnings: string[];
    journalCount: number;
    settlementCount: number;
    incompleteSettlementCount: number;
  } = {
    ok: false,
    errors: [],
    warnings: [],
    journalCount: 0,
    settlementCount: 0,
    incompleteSettlementCount: 0,
  };

  if (jsonStart >= 0) {
    const jsonText = lines.slice(jsonStart).join('\n');

    try {
      report = JSON.parse(jsonText);
    } catch {
      /* leave report empty */
    }
  }

  /*
   * Filter out the "Risk state cross-check skipped" warning
   * which fires when no live RPC is available (expected in
   * test environments). We only care about settlement-specific
   * errors and warnings.
   */
  function settlementErrors(
    report: {
      errors: string[];
    }
  ): string[] {
    return report.errors.filter(
      (e) =>
        !/Risk state cross-check skipped/i.test(
          e
        )
    );
  }

  function settlementWarnings(
    report: {
      warnings: string[];
    }
  ): string[] {
    return report.warnings.filter(
      (w) =>
        !/Risk state cross-check skipped/i.test(
          w
        )
    );
  }

  return {
    status: result.status,
    stdout,
    stderr,
    report,
    settlementErrors:
      settlementErrors(report),
    settlementWarnings:
      settlementWarnings(report),
  };
}

test(
  'committed confirmed settlement matches journal',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-dr-conf',
      'instance-dr-conf',
      'sig-dr-conf'
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

    const result = runDoctor();

    const report = result.report;

    assert.equal(
      result.settlementErrors.length,
      0,
      `errors: ${JSON.stringify(result.settlementErrors)}`
    );
    assert.equal(
      result.settlementWarnings.length,
      0,
      `warnings: ${JSON.stringify(result.settlementWarnings)}`
    );
    assert.equal(report.settlementCount, 1);
    assert.equal(report.incompleteSettlementCount, 0);
  }
);

test(
  'committed failed settlement matches journal',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-dr-fail',
      'instance-dr-fail',
      'sig-dr-fail'
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

    const result = runDoctor();

    const report = result.report;

    assert.equal(
      result.settlementErrors.length,
      0,
      `unexpected errors: ${JSON.stringify(result.settlementErrors)}`
    );
    assert.equal(
      result.settlementWarnings.length,
      0,
      `unexpected warnings: ${JSON.stringify(result.settlementWarnings)}`
    );
  }
);

test(
  'terminal journal without settlement rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Create a confirmed journal directly (via the reconciler
     * path, which now goes through settlement). But to test
     * the "no settlement" case, we need to create the terminal
     * journal WITHOUT a settlement. We do this by calling the
     * journal transitions directly and skipping settlement.
     */
    const journalModule = await import('../sniper/execution-journal.js');

    /*
     * Create a confirmed journal directly (via the journal
     * transitions, NOT via settlement). We use
     * createSubmittedExecution to set up the artifact+plan+
     * reservation+journal, then mark it confirmed manually.
     */
    const journal = await createSubmittedExecution(
      'plan-dr-no-settle',
      'instance-dr-no-settle',
      'sig-no-settle'
    );

    await journalModule.markExecutionConfirmed(journal.executionId, {
      slot: 333,
      confirmationStatus: 'confirmed',
    });

    const result = runDoctor();

    const report = result.report;

    assert.ok(
      result.settlementErrors.some(
        (e: string) =>
          /Terminal execution.*has no settlement journal/i.test(e)
      )
    );
  }
);

test(
  'settlement without journal rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Create a settlement via the normal path, then delete
     * the execution journal file.
     */
    const journal = await createSubmittedExecution(
      'plan-dr-orphan-settle',
      'instance-dr-orphan-settle',
      'sig-orphan-settle'
    );

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 444,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    /*
     * Delete the journal file.
     */
    const journalPath = join(
      planDir,
      'execution-journals',
      `${journal.executionId}.json`
    );

    await rm(journalPath, { force: true });

    const result = runDoctor();

    const report = result.report;

    assert.ok(
      result.settlementErrors.some(
        (e: string) =>
          /Settlement.*has no execution journal/i.test(e)
      )
    );
  }
);

test(
  'identity mismatch rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Create a settlement, then tamper with the planId
     * in the settlement file (recomputing the hash so
     * it passes hash validation but fails the identity
     * cross-check).
     */
    const journal = await createSubmittedExecution(
      'plan-dr-id-mismatch',
      'instance-dr-id-mismatch',
      'sig-id-mismatch'
    );

    const {
      settleExecutionOutcome,
      loadExecutionSettlement,
    } = await import('../sniper/execution-settlement.js');

    const settlement = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 555,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    /*
     * Tamper: change planId in the settlement file and
     * recompute the hash.
     */
    const { createHash } = await import('node:crypto');
    const settlementPath = join(
      planDir,
      'execution-settlements',
      `${settlement.settlementId}.json`
    );

    const content = await readFile(settlementPath, 'utf8');
    const parsed = JSON.parse(content);

    parsed.planId = 'tampered-plan-id';

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

    const { settlementSha256, ...body } = parsed;
    parsed.settlementSha256 = createHash('sha256')
      .update(stableStringify(body))
      .digest('hex');

    await writeFile(settlementPath, JSON.stringify(parsed, null, 2), 'utf8');

    const result = runDoctor();

    const report = result.report;

    assert.ok(
      result.settlementErrors.some(
        (e: string) =>
          /identity does not match execution journal/i.test(e)
      )
    );
  }
);

test(
  'slot mismatch rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Create a confirmed settlement, then tamper the
     * journal's confirmedSlot to differ from the
     * settlement's observedSlot.
     */
    const journal = await createSubmittedExecution(
      'plan-dr-slot-mismatch',
      'instance-dr-slot-mismatch',
      'sig-slot-mismatch'
    );

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 666,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    /*
     * Tamper: modify the journal's confirmedSlot.
     * The journal is tamper-evident, so we need to
     * recompute its hash too.
     */
    const { createHash } = await import('node:crypto');
    const journalPath = join(
      planDir,
      'execution-journals',
      `${journal.executionId}.json`
    );

    const content = await readFile(journalPath, 'utf8');
    const parsed = JSON.parse(content);

    parsed.confirmedSlot = 999;

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

    const { journalSha256, ...body } = parsed;
    parsed.journalSha256 = createHash('sha256')
      .update(stableStringify(body))
      .digest('hex');

    await writeFile(journalPath, JSON.stringify(parsed, null, 2), 'utf8');

    const result = runDoctor();

    const report = result.report;

    assert.ok(
      result.settlementErrors.some(
        (e: string) =>
          /slot does not match journal/i.test(e)
      )
    );
  }
);

test(
  'incomplete settlement produces warning',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-dr-incomplete',
      'instance-dr-incomplete',
      'sig-incomplete'
    );

    /*
     * Call settleExecutionOutcome but crash midway by
     * manually creating a 'pending' settlement file.
     * We can't easily do this via the public API, so
     * we write a minimal pending settlement directly.
     */
    const { createHash } = await import('node:crypto');
    const settlementId = createHash('sha256')
      .update(`execution-settlement-v1:${journal.executionId}`)
      .digest('hex')
      .slice(0, 32);

    const settlementPath = join(
      planDir,
      'execution-settlements',
      `${settlementId}.json`
    );

    await mkdir(join(settlementPath, '..'), {
      recursive: true,
      mode: 0o700,
    });

    const settlementBody = {
      version: 1,
      settlementId,
      executionId: journal.executionId,
      planId: journal.planId,
      planInstanceId: journal.planInstanceId,
      artifactId: journal.artifactId,
      riskReservationId: journal.riskReservationId,
      outcome: 'confirmed' as const,
      observedSlot: 777,
      confirmationStatus: 'confirmed' as const,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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

    const settlementSha256 = createHash('sha256')
      .update(stableStringify(settlementBody))
      .digest('hex');

    await writeFile(
      settlementPath,
      JSON.stringify(
        { ...settlementBody, settlementSha256 },
        null,
        2
      ),
      { encoding: 'utf8', mode: 0o600 }
    );

    const result = runDoctor();

    const report = result.report;

    assert.ok(
      result.settlementWarnings.some(
        (w: string) =>
          /Settlement.*is incomplete at pending/i.test(w)
      )
    );
    assert.equal(report.incompleteSettlementCount, 1);
  }
);

test(
  'corrupt settlement causes exit code 2',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-dr-corrupt',
      'instance-dr-corrupt',
      'sig-corrupt'
    );

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    const settlement = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 888,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });

    /*
     * Corrupt the settlement file.
     */
    const settlementPath = join(
      planDir,
      'execution-settlements',
      `${settlement.settlementId}.json`
    );

    await writeFile(
      settlementPath,
      '{ invalid json',
      'utf8'
    );

    const result = runDoctor();

    assert.equal(result.status, 2);

    const report = result.report;

    assert.ok(result.settlementErrors.length > 0);
  }
);
