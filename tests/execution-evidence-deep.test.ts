import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  symlink,
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
    join(tmpdir(), 'sniper-deep-evidence-')
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

  const dummyTx = new VersionedTransaction(message);
  const serializedTx = Buffer.from(dummyTx.serialize());

  return persistSimulationArtifact({
    planId,
    planInstanceId,
    planSha256BeforeSimulation: 'e'.repeat(64),
    serializedTransaction: serializedTx,
    simulationResponse: { contextSlot: 1, err: null, logs: [] },
    createdAt: new Date().toISOString(),
  });
}

async function writePlan(
  planId: string,
  planInstanceId: string,
  artifactId: string,
  artifactSha256: string,
  serializedTransactionSha256: string
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
      serializedTransactionSha256,
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

async function createSubmittedExecutionWithSettlement(
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

  const storedArtifact = await createArtifact(planId, planInstanceId);

  const { createHash } = await import('node:crypto');

  const serializedTransactionSha256 = createHash('sha256')
    .update(Buffer.from(storedArtifact.serializedTransactionBase64, 'base64'))
    .digest('hex');

  await writePlan(
    planId,
    planInstanceId,
    storedArtifact.artifactId,
    storedArtifact.artifactSha256,
    serializedTransactionSha256
  );

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

  return journal;
}

async function exportBundle(planId: string): Promise<string> {
  const outputPath = join(planDir, `${planId}-bundle.json`);

  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      'sniper/export-execution-evidence.ts',
      planId,
      '--output',
      outputPath,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
    }
  );

  if (result.status !== 0) {
    throw new Error(
      `Export failed: ${result.stderr}`
    );
  }

  return outputPath;
}

function verifyBundle(
  bundlePath: string,
  jsonFlag?: string
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const args = [bundlePath];
  if (jsonFlag) args.push(jsonFlag);

  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      'sniper/verify-execution-evidence.ts',
      ...args,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
    }
  );

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

test(
  'valid exported bundle passes',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecutionWithSettlement(
      'plan-deep-valid',
      'instance-deep-valid',
      'sig-deep-valid'
    );

    const bundlePath = await exportBundle('plan-deep-valid');
    const result = verifyBundle(bundlePath);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /VALID/);
  }
);

test(
  'tampered artifact hash rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecutionWithSettlement(
      'plan-deep-art-hash',
      'instance-deep-art-hash',
      'sig-deep-art-hash'
    );

    const bundlePath = await exportBundle('plan-deep-art-hash');

    /*
     * Tamper with the artifact's artifactSha256.
     */
    const content = await readFile(bundlePath, 'utf8');
    const bundle = JSON.parse(content);

    bundle.artifact.artifactSha256 = '0'.repeat(64);

    /*
     * Recompute the bundle hash so the outer hash check
     * passes but the inner artifact hash check fails.
     */
    const { createHash } = await import('node:crypto');

    const { bundleSha256, ...withoutHash } = bundle;
    bundle.bundleSha256 = createHash('sha256')
      .update(stableStringify(withoutHash))
      .digest('hex');

    await writeFile(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');

    const result = verifyBundle(bundlePath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stdout + result.stderr,
      /Artifact validation failed|artifact SHA-256 mismatch/i
    );
  }
);

test(
  'tampered transaction bytes reject',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecutionWithSettlement(
      'plan-deep-tx-bytes',
      'instance-deep-tx-bytes',
      'sig-deep-tx-bytes'
    );

    const bundlePath = await exportBundle('plan-deep-tx-bytes');

    const content = await readFile(bundlePath, 'utf8');
    const bundle = JSON.parse(content);

    /*
     * Tamper with the serialized transaction bytes.
     */
    const originalBytes = bundle.artifact.serializedTransactionBase64;
    const tamperedBytes = originalBytes.slice(0, -4) + 'AAAA';

    bundle.artifact.serializedTransactionBase64 = tamperedBytes;

    /*
     * Recompute the artifact hash and bundle hash.
     */
    const { createHash } = await import('node:crypto');

    function stableStr(value: unknown): string {
      if (value === null || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(stableStr).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
      return `{${entries
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStr(v)}`)
        .join(',')}}`;
    }

    const { artifactSha256, ...artifactBody } = bundle.artifact;
    bundle.artifact.artifactSha256 = createHash('sha256')
      .update(stableStr(artifactBody))
      .digest('hex');

    const { bundleSha256, ...bundleBody } = bundle;
    bundle.bundleSha256 = createHash('sha256')
      .update(stableStr(bundleBody))
      .digest('hex');

    await writeFile(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');

    const result = verifyBundle(bundlePath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stdout + result.stderr,
      /transaction bytes do not match receipt/i
    );
  }
);

test(
  'tampered journal hash rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecutionWithSettlement(
      'plan-deep-journal-hash',
      'instance-deep-journal-hash',
      'sig-deep-journal-hash'
    );

    const bundlePath = await exportBundle('plan-deep-journal-hash');

    const content = await readFile(bundlePath, 'utf8');
    const bundle = JSON.parse(content);

    /*
     * Tamper with the journal's status without updating
     * its hash.
     */
    bundle.journals[0].status = 'failed';

    const { createHash } = await import('node:crypto');
    const { bundleSha256, ...withoutHash } = bundle;
    bundle.bundleSha256 = createHash('sha256')
      .update(stableStringify(withoutHash))
      .digest('hex');

    await writeFile(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');

    const result = verifyBundle(bundlePath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stdout + result.stderr,
      /Journal.*validation failed|hash mismatch/i
    );
  }
);

test(
  'tampered settlement hash rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecutionWithSettlement(
      'plan-deep-settle-hash',
      'instance-deep-settle-hash',
      'sig-deep-settle-hash'
    );

    const bundlePath = await exportBundle('plan-deep-settle-hash');

    const content = await readFile(bundlePath, 'utf8');
    const bundle = JSON.parse(content);

    bundle.settlements[0].observedSlot = 999;

    const { createHash } = await import('node:crypto');
    const { bundleSha256, ...withoutHash } = bundle;
    bundle.bundleSha256 = createHash('sha256')
      .update(stableStringify(withoutHash))
      .digest('hex');

    await writeFile(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');

    const result = verifyBundle(bundlePath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stdout + result.stderr,
      /Settlement.*validation failed|hash mismatch/i
    );
  }
);

test(
  'plan-outcome mismatch rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecutionWithSettlement(
      'plan-deep-outcome-mismatch',
      'instance-deep-outcome-mismatch',
      'sig-deep-outcome-mismatch'
    );

    const bundlePath = await exportBundle('plan-deep-outcome-mismatch');

    const content = await readFile(bundlePath, 'utf8');
    const bundle = JSON.parse(content);

    /*
     * Change the plan's execution outcome to 'failed'
     * while the settlement is 'confirmed'.
     */
    bundle.plan.state.executionOutcome.outcome = 'failed';

    const { createHash } = await import('node:crypto');

    /*
     * Recompute the plan's hash.
     */
    function stableStr(value: unknown): string {
      if (value === null || typeof value !== 'object') return JSON.stringify(value);
      if (Array.isArray(value)) return `[${value.map(stableStr).join(',')}]`;
      const entries = Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b));
      return `{${entries
        .map(([k, v]) => `${JSON.stringify(k)}:${stableStr(v)}`)
        .join(',')}}`;
    }

    const planContent = {
      version: 3,
      planId: bundle.plan.planId,
      planInstanceId: bundle.plan.planInstanceId,
      state: bundle.plan.state,
      payload: bundle.plan.payload,
    };

    bundle.plan.sha256 = createHash('sha256')
      .update(stableStr(planContent))
      .digest('hex');

    const { bundleSha256, ...bundleBody } = bundle;
    bundle.bundleSha256 = createHash('sha256')
      .update(stableStringify(bundleBody))
      .digest('hex');

    await writeFile(bundlePath, JSON.stringify(bundle, null, 2), 'utf8');

    const result = verifyBundle(bundlePath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stdout + result.stderr,
      /outcome does not match settlement/i
    );
  }
);

test(
  'symlink bundle rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const target = join(planDir, 'target.json');
    const symlinkPath = join(planDir, 'symlink-bundle.json');

    await writeFile(target, '{}', 'utf8');
    await symlink(target, symlinkPath);

    const result = verifyBundle(symlinkPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /symbolic link/i
    );
  }
);

test(
  'oversized bundle rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const bigPath = join(planDir, 'big-bundle.json');

    /*
     * Write a file larger than 50MB.
     */
    const bigContent = 'x'.repeat(51 * 1024 * 1024);
    await writeFile(bigPath, bigContent, 'utf8');

    const result = verifyBundle(bigPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /size is invalid/i
    );
  }
);

test(
  'invalid JSON exits 2',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const badPath = join(planDir, 'bad-json.json');
    await writeFile(badPath, '{ invalid json', 'utf8');

    const result = verifyBundle(badPath);

    assert.equal(result.status, 2);
    assert.match(
      result.stderr,
      /invalid JSON/i
    );
  }
);

test(
  'JSON output contains no raw private key',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecutionWithSettlement(
      'plan-deep-redact',
      'instance-deep-redact',
      'sig-deep-redact'
    );

    const bundlePath = await exportBundle('plan-deep-redact');
    const result = verifyBundle(bundlePath, '--json');

    assert.doesNotMatch(
      result.stdout + result.stderr,
      /privateKey|secretKey|seed/i
    );
  }
);
