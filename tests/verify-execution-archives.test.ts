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
    join(tmpdir(), 'sniper-arch-doctor-')
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

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`;
}

async function createArtifact(planId: string, planInstanceId: string) {
  const { persistSimulationArtifact } = await import(
    '../sniper/simulation-artifact-store.js'
  );

  const { VersionedTransaction, MessageV0, PublicKey, TransactionInstruction } =
    await import('@solana/web3.js');

  const feePayer = new PublicKey(WALLET_PUBLIC_KEY);
  const dummyProgram = new PublicKey('11111111111111111111111111111112');

  const data = Buffer.alloc(4);
  data.writeUInt32LE(Date.now() & 0xffffffff, 0);

  const message = MessageV0.compile({
    payerKey: feePayer,
    instructions: [
      new TransactionInstruction({
        keys: [{ pubkey: feePayer, isSigner: true, isWritable: true }],
        programId: dummyProgram,
        data,
      }),
    ],
    recentBlockhash: '11111111111111111111111111111111',
    addressLookupTableAccounts: [],
  });

  const tx = new VersionedTransaction(message);
  const serializedTx = Buffer.from(tx.serialize());

  const { createHash } = await import('node:crypto');

  const serializedTxSha = createHash('sha256')
    .update(serializedTx)
    .digest('hex');

  const messageSha = createHash('sha256')
    .update(message.serialize())
    .digest('hex');

  return persistSimulationArtifact({
    planId,
    planInstanceId,
    planSha256BeforeSimulation: 'e'.repeat(64),
    serializedTransaction: serializedTx,
    simulationResponse: { contextSlot: 1, err: null, logs: [] },
    createdAt: new Date().toISOString(),
  }).then((stored) => ({
    stored,
    serializedTxSha,
    messageSha,
  }));
}

async function writePlan(
  planId: string,
  planInstanceId: string,
  artifactId: string,
  artifactSha256: string,
  serializedTxSha: string,
  messageSha: string
) {
  const { createHash } = await import('node:crypto');
  const { getApprovedExecutionPlanPath } = await import(
    '../sniper/execution-plan.js'
  );

  const state = {
    status: 'simulated' as const,
    simulationCount: 1,
    createdAt: new Date(Date.now() - 100_000).toISOString(),
    simulatedAt: new Date().toISOString(),
    simulationReceipt: {
      transactionMessageSha256: messageSha,
      serializedTransactionSha256: serializedTxSha,
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
      artifactSha256,
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

  const hash = createHash('sha256')
    .update(stableStringify({ version: 3, planId, planInstanceId, state, payload }))
    .digest('hex');

  const path = getApprovedExecutionPlanPath(planId);
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    JSON.stringify({ version: 3, planId, planInstanceId, state, payload, sha256: hash }, null, 2),
    'utf8'
  );
}

async function createTerminalExecution(
  planId: string,
  planInstanceId: string,
  outcome: 'confirmed' | 'failed'
) {
  const {
    beginExecution,
    markExecutionSigning,
    markExecutionBroadcastReady,
    markExecutionSubmitted,
  } = await import('../sniper/execution-journal.js');

  const { reserveTradeOnce } = await import('../sniper/risk.js');

  const { stored, serializedTxSha, messageSha } = await createArtifact(planId, planInstanceId);

  await writePlan(
    planId,
    planInstanceId,
    stored.artifactId,
    stored.artifactSha256,
    serializedTxSha,
    messageSha
  );

  const journal = await beginExecution(planId, planInstanceId, stored.artifactId);

  await reserveTradeOnce(
    journal.riskReservationId!,
    EXACT_MINT,
    BigInt(BUY_LAMPORTS),
    FAKE_WALLET_BALANCE
  );

  await markExecutionSigning(journal.executionId);
  await markExecutionBroadcastReady(journal.executionId, {
    transactionSignature: `sig-${planId}`,
    signedTransactionSha256: SIGNED_TX_SHA,
    transactionMessageSha256: MSG_SHA,
    lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
  });
  await markExecutionSubmitted(journal.executionId, `sig-${planId}`);

  const { settleExecutionOutcome } = await import(
    '../sniper/execution-settlement.js'
  );

  if (outcome === 'confirmed') {
    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 111,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });
  } else {
    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'failed',
      observedSlot: 222,
      failureReason: 'on-chain error',
      currentBalanceLamports: FAKE_WALLET_BALANCE,
    });
  }

  return journal;
}

async function archivePlan(planId: string) {
  const { archiveExecutionEvidence } = await import(
    '../sniper/execution-archive.js'
  );

  return archiveExecutionEvidence(planId);
}

function runVerifyArchives(jsonFlag?: string): {
  status: number | null;
  stdout: string;
  stderr: string;
  report: Record<string, unknown> | null;
} {
  const args: string[] = [];
  if (jsonFlag) args.push(jsonFlag);

  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      'sniper/verify-execution-archives.ts',
      ...args,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
    }
  );

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

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
      report = JSON.parse(lines.slice(jsonStart).join('\n'));
    } catch {
      /* leave report null */
    }
  }

  return { status: result.status, stdout, stderr, report };
}

test(
  'valid archive and index pass',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-arch-dr-valid',
      'instance-arch-dr-valid',
      'confirmed'
    );

    await archivePlan('plan-arch-dr-valid');

    const result = runVerifyArchives('--json');

    assert.equal(result.status, 0);
    assert.ok(result.report);
    assert.equal(result.report.ok, true);
    assert.equal(result.report.archiveCount, 1);
    assert.equal(result.report.indexEntryCount, 1);
  }
);

test(
  'missing archive file rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-arch-dr-missing',
      'instance-arch-dr-missing',
      'confirmed'
    );

    await archivePlan('plan-arch-dr-missing');

    /*
     * Delete the archive file but keep the index.
     */
    const archivePath = join(planDir, 'execution-archives', 'instance-arch-dr-missing.json');
    await rm(archivePath, { force: true });

    const result = runVerifyArchives('--json');

    assert.notEqual(result.status, 0);
    assert.ok(result.report);
    assert.ok(
      (result.report.errors as string[]).some((e) =>
        /missing file/i.test(e)
      )
    );
  }
);

test(
  'unindexed archive warns',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-arch-dr-unindexed',
      'instance-arch-dr-unindexed',
      'confirmed'
    );

    await archivePlan('plan-arch-dr-unindexed');

    /*
     * Delete the index file.
     */
    const indexPath = join(planDir, 'execution-archives', 'index.jsonl');
    await rm(indexPath, { force: true });

    const result = runVerifyArchives('--json');

    assert.notEqual(result.status, 0);
    assert.ok(result.report);
    assert.ok(
      (result.report.warnings as string[]).some((w) =>
        /missing from index/i.test(w)
      )
    );
  }
);

test(
  'archive/index hash mismatch rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-arch-dr-hash-mismatch',
      'instance-arch-dr-hash-mismatch',
      'confirmed'
    );

    await archivePlan('plan-arch-dr-hash-mismatch');

    /*
     * Tamper the archive file's archivedAt timestamp (which
     * changes archiveSha256) and recompute the archive hash
     * so it loads, but the archiveSha256 no longer matches
     * the index entry.
     */
    const archivePath = join(planDir, 'execution-archives', 'instance-arch-dr-hash-mismatch.json');
    const content = await readFile(archivePath, 'utf8');
    const parsed = JSON.parse(content);

    parsed.archivedAt = '1970-01-01T00:00:00.000Z';

    const { createHash } = await import('node:crypto');
    const { archiveSha256, ...archiveBody } = parsed;
    parsed.archiveSha256 = createHash('sha256')
      .update(stableStringify(archiveBody))
      .digest('hex');

    await writeFile(archivePath, JSON.stringify(parsed, null, 2), 'utf8');

    const result = runVerifyArchives('--json');

    assert.notEqual(result.status, 0);
    assert.ok(result.report);
    assert.ok(
      (result.report.errors as string[]).some((e) =>
        /hash does not match index/i.test(e)
      )
    );
  }
);

test(
  'corrupt archive rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-arch-dr-corrupt',
      'instance-arch-dr-corrupt',
      'confirmed'
    );

    await archivePlan('plan-arch-dr-corrupt');

    const archivePath = join(planDir, 'execution-archives', 'instance-arch-dr-corrupt.json');
    await writeFile(archivePath, '{ invalid json', 'utf8');

    const result = runVerifyArchives('--json');

    assert.notEqual(result.status, 0);
    assert.ok(result.report);
    assert.ok(
      (result.report.errors as string[]).some((e) =>
        /failed verification/i.test(e)
      )
    );
  }
);

test(
  'corrupt index rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-arch-dr-corrupt-idx',
      'instance-arch-dr-corrupt-idx',
      'confirmed'
    );

    await archivePlan('plan-arch-dr-corrupt-idx');

    const indexPath = join(planDir, 'execution-archives', 'index.jsonl');
    await writeFile(indexPath, 'invalid json\n', 'utf8');

    const result = runVerifyArchives('--json');

    assert.notEqual(result.status, 0);
    assert.ok(result.report);
    assert.ok(
      (result.report.errors as string[]).some((e) =>
        /invalid JSON/i.test(e)
      )
    );
  }
);

test(
  'JSON output is stable',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const result = runVerifyArchives('--json');

    assert.ok(result.report);
    assert.equal(typeof result.report.ok, 'boolean');
    assert.equal(typeof result.report.archiveCount, 'number');
    assert.equal(typeof result.report.indexEntryCount, 'number');
    assert.ok(Array.isArray(result.report.errors));
    assert.ok(Array.isArray(result.report.warnings));
  }
);

test(
  'empty archive directory is healthy',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const result = runVerifyArchives();

    assert.equal(result.status, 0);
    assert.match(result.stdout, /VALID/);
  }
);

test(
  'bundle/index hash mismatch rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-arch-dr-bundle-mismatch',
      'instance-arch-dr-bundle-mismatch',
      'confirmed'
    );

    await archivePlan('plan-arch-dr-bundle-mismatch');

    /*
     * Tamper the archive file's evidenceBundle.bundleSha256
     * and recompute the archive hash so it loads.
     */
    const archivePath = join(planDir, 'execution-archives', 'instance-arch-dr-bundle-mismatch.json');
    const content = await readFile(archivePath, 'utf8');
    const parsed = JSON.parse(content);

    parsed.evidenceBundle.bundleSha256 = '1'.repeat(64);

    const { createHash } = await import('node:crypto');
    const { archiveSha256, ...body } = parsed;
    parsed.archiveSha256 = createHash('sha256')
      .update(stableStringify(body))
      .digest('hex');

    await writeFile(archivePath, JSON.stringify(parsed, null, 2), 'utf8');

    const result = runVerifyArchives('--json');

    assert.notEqual(result.status, 0);
    assert.ok(result.report);
    assert.ok(
      (result.report.errors as string[]).some((e) =>
        /bundle hash does not match index|Archive SHA-256 mismatch|verification failed/i.test(e)
      )
    );
  }
);
