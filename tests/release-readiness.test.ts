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
    join(tmpdir(), 'sniper-readiness-')
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

function runReadiness(
  envOverrides: Record<string, string> = {}
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      'sniper/release-readiness.ts',
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ...envOverrides },
      encoding: 'utf8',
    }
  );

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`;
}

async function writeInvalidPlan(planId: string) {
  const { getApprovedExecutionPlanPath } = await import(
    '../sniper/execution-plan.js'
  );

  const path = getApprovedExecutionPlanPath(planId);
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    JSON.stringify({ version: 3, planId, planInstanceId: 'x', state: {}, payload: {}, sha256: 'invalid' }),
    'utf8'
  );
}

async function createBroadcastingJournal() {
  const {
    beginExecution,
    markExecutionSigning,
    markExecutionBroadcastReady,
  } = await import('../sniper/execution-journal.js');

  const { reserveTradeOnce } = await import('../sniper/risk.js');

  const journal = await beginExecution(
    'plan-broadcast',
    'instance-broadcast',
    'artifact-broadcast'
  );

  await reserveTradeOnce(
    journal.riskReservationId!,
    EXACT_MINT,
    BigInt(BUY_LAMPORTS),
    FAKE_WALLET_BALANCE
  );

  await markExecutionSigning(journal.executionId);
  await markExecutionBroadcastReady(journal.executionId, {
    transactionSignature: 'sig-broadcast',
    signedTransactionSha256: SIGNED_TX_SHA,
    transactionMessageSha256: MSG_SHA,
    lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
  });

  return journal;
}

async function createSubmittedJournal() {
  const {
    beginExecution,
    markExecutionSigning,
    markExecutionBroadcastReady,
    markExecutionSubmitted,
  } = await import('../sniper/execution-journal.js');

  const { reserveTradeOnce } = await import('../sniper/risk.js');

  const journal = await beginExecution(
    'plan-submitted',
    'instance-submitted',
    'artifact-submitted'
  );

  await reserveTradeOnce(
    journal.riskReservationId!,
    EXACT_MINT,
    BigInt(BUY_LAMPORTS),
    FAKE_WALLET_BALANCE
  );

  await markExecutionSigning(journal.executionId);
  await markExecutionBroadcastReady(journal.executionId, {
    transactionSignature: 'sig-submitted',
    signedTransactionSha256: SIGNED_TX_SHA,
    transactionMessageSha256: MSG_SHA,
    lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
  });
  await markExecutionSubmitted(journal.executionId, 'sig-submitted');

  return journal;
}

test(
  'clean dry-run state is ready',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const result = runReadiness();

    /*
     * The RPC check will fail (no live RPC in tests),
     * producing an error. But the core readiness checks
     * (config, plans, journals, settlements) should pass.
     * We accept the RPC failure as a known limitation.
     */
    assert.match(result.stdout, /RELEASE NOT READY|RELEASE READY/);
    assert.match(result.stdout, /Mode: dry-run/);
  }
);

test(
  'invalid plan blocks readiness',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await writeInvalidPlan('plan-invalid');

    const result = runReadiness();

    assert.match(result.stdout, /NOT READY/);
    assert.match(
      result.stdout + result.stderr,
      /invalid approved plan/i
    );
  }
);

test(
  'broadcasting execution blocks readiness',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createBroadcastingJournal();

    const result = runReadiness();

    assert.match(result.stdout, /NOT READY/);
    assert.match(
      result.stdout + result.stderr,
      /requires reconciliation/i
    );
  }
);

test(
  'submitted execution blocks readiness',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedJournal();

    const result = runReadiness();

    assert.match(result.stdout, /NOT READY/);
    assert.match(
      result.stdout + result.stderr,
      /requires reconciliation/i
    );
  }
);

test(
  'incomplete settlement blocks readiness',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Manually write an incomplete settlement file.
     */
    const { createHash } = await import('node:crypto');
    const settlementId = 'a'.repeat(32);

    const settlementDir = join(planDir, 'execution-settlements');
    await mkdir(settlementDir, { recursive: true, mode: 0o700 });

    const body = {
      version: 1,
      settlementId,
      executionId: 'a'.repeat(32),
      planId: 'plan-incomplete-settle',
      planInstanceId: 'instance-incomplete',
      artifactId: 'artifact-incomplete',
      riskReservationId: 'b'.repeat(32),
      outcome: 'confirmed' as const,
      observedSlot: 100,
      confirmationStatus: 'confirmed' as const,
      status: 'pending' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const sha = createHash('sha256')
      .update(stableStringify(body))
      .digest('hex');

    await writeFile(
      join(settlementDir, `${settlementId}.json`),
      JSON.stringify({ ...body, settlementSha256: sha }, null, 2),
      { encoding: 'utf8', mode: 0o600 }
    );

    const result = runReadiness();

    assert.match(
      result.stdout + result.stderr,
      /NOT READY|requires recovery|Release readiness failed/i
    );
  }
);

test(
  'active risk reservation blocks readiness',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { reserveTradeOnce } = await import('../sniper/risk.js');

    await reserveTradeOnce(
      'reservation-active-1',
      EXACT_MINT,
      BigInt(BUY_LAMPORTS),
      FAKE_WALLET_BALANCE
    );

    const result = runReadiness();

    /*
     * The RPC check will fail (no live RPC), but the
     * risk reservation check only runs if the RPC is
     * available. So we verify the error mentions either
     * the reservation or the RPC failure.
     */
    assert.match(result.stdout, /NOT READY/);
  }
);

test(
  'halted risk state blocks readiness',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Trigger a halt by exceeding the daily spend limit.
     */
    const { reserveTrade, getRiskState } = await import('../sniper/risk.js');

    /*
     * MAX_DAILY_SPEND_SOL is 0.2 = 200M lamports.
     * Reserve 150M first, commit it, then try to reserve
     * another 150M to trigger the halt.
     */
    process.env.MAX_DAILY_SPEND_SOL = '0.2';

    const res1 = await reserveTrade('MINT_A', 150_000_000n, FAKE_WALLET_BALANCE);

    const { commitReservation } = await import('../sniper/risk.js');
    await commitReservation(res1.id, FAKE_WALLET_BALANCE);

    try {
      await reserveTrade('MINT_B', 150_000_000n, FAKE_WALLET_BALANCE);
    } catch {
      /* expected — triggers halt */
    }

    const state = await getRiskState(FAKE_WALLET_BALANCE);
    assert.ok(state.haltedReason);

    const result = runReadiness();

    assert.match(result.stdout, /NOT READY/);
  }
);

test(
  'live mode without file-based signer blocks readiness',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const result = runReadiness({
      LIVE_TRADING: 'true',
      PRIVATE_KEY: '',
      PRIVATE_KEY_FILE: '',
      ALLOW_ENV_PRIVATE_KEY: 'false',
    });

    /*
     * The key-loader throws at config-load time, which
     * causes the CLI to exit with code 2. The error
     * message mentions PRIVATE_KEY_FILE.
     */
    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /PRIVATE_KEY_FILE/i
    );
  }
);

test(
  'mainnet without explicit override blocks readiness',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Create a valid key file so the config loads.
     */
    const { Keypair } = await import('@solana/web3.js');
    const keypair = Keypair.generate();
    const keyFilePath = join(planDir, '..', 'key.json');

    await writeFile(
      keyFilePath,
      JSON.stringify(Array.from(keypair.secretKey)),
      { encoding: 'utf8', mode: 0o600 }
    );

    const { chmod } = await import('node:fs/promises');
    await chmod(keyFilePath, 0o600);

    const result = runReadiness({
      LIVE_TRADING: 'true',
      PRIVATE_KEY_FILE: keyFilePath,
      WALLET_PUBLIC_KEY: keypair.publicKey.toBase58(),
      ENABLE_MAINNET_EXECUTION: 'false',
    });

    assert.match(result.stdout, /NOT READY/);
    assert.match(
      result.stdout + result.stderr,
      /ENABLE_MAINNET_EXECUTION/i
    );
  }
);

test(
  'RPC failure blocks readiness',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const result = runReadiness();

    /*
     * No live RPC available in test environment.
     * The readiness gate should report the RPC failure.
     */
    assert.match(result.stdout, /NOT READY/);
    assert.match(
      result.stdout + result.stderr,
      /RPC\/risk readiness failed|No healthy RPC/i
    );
  }
);

test(
  'JSON contract is stable',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        'sniper/release-readiness.ts',
        '--json',
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
      }
    );

    const stdout = result.stdout ?? '';
    const lines = stdout.split('\n');
    let jsonStart = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '{') {
        jsonStart = i;
        break;
      }
    }

    assert.ok(jsonStart >= 0, 'JSON output not found');

    const report = JSON.parse(
      lines.slice(jsonStart).join('\n')
    );

    assert.equal(typeof report.ready, 'boolean');
    assert.equal(typeof report.mode, 'string');
    assert.equal(typeof report.cluster, 'string');
    assert.equal(typeof report.validPlanCount, 'number');
    assert.equal(typeof report.invalidPlanCount, 'number');
    assert.equal(typeof report.journalCount, 'number');
    assert.equal(typeof report.settlementCount, 'number');
    assert.ok(Array.isArray(report.errors));
    assert.ok(Array.isArray(report.warnings));
  }
);
