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
const WALLET_PUBLIC_KEY = '11111111111111111111111111111111';
const EXACT_MINT = 'TEST_MINT_A';
const BUY_LAMPORTS = '50000000';

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-preview-')
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
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`;
}

async function createPlanWithArtifact(
  planId: string,
  planInstanceId: string
) {
  const { createHash } = await import('node:crypto');
  const { getApprovedExecutionPlanPath } = await import(
    '../sniper/execution-plan.js'
  );
  const { persistSimulationArtifact } = await import(
    '../sniper/simulation-artifact-store.js'
  );

  const {
    VersionedTransaction,
    MessageV0,
    PublicKey,
    TransactionInstruction,
  } = await import('@solana/web3.js');

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

  const serializedTxSha = createHash('sha256')
    .update(serializedTx)
    .digest('hex');

  const messageSha = createHash('sha256')
    .update(message.serialize())
    .digest('hex');

  const storedArtifact = await persistSimulationArtifact({
    planId,
    planInstanceId,
    planSha256BeforeSimulation: 'e'.repeat(64),
    serializedTransaction: serializedTx,
    simulationResponse: { contextSlot: 1, err: null, logs: [] },
    createdAt: new Date().toISOString(),
  });

  const state = {
    status: 'simulated' as const,
    simulationCount: 1,
    createdAt: new Date(Date.now() - 1_000).toISOString(),
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
      artifactId: storedArtifact.artifactId,
      artifactSha256: storedArtifact.artifactSha256,
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

  return { storedArtifact, serializedTxSha, messageSha };
}

function runPreview(
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
      'sniper/preview-verified-execution.ts',
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
      report = JSON.parse(
        lines.slice(jsonStart).join('\n')
      );
    } catch {
      /* leave report null */
    }
  }

  return { status: result.status, stdout, stderr, report };
}

test(
  'preview returns exact hash and message hash',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { serializedTxSha, messageSha } =
      await createPlanWithArtifact('plan-preview-hash', 'instance-preview-hash');

    const result = runPreview('plan-preview-hash', '--json');

    assert.equal(result.status, 0);
    assert.ok(result.report);

    assert.equal(
      result.report.serializedTransactionSha256,
      serializedTxSha
    );
    assert.equal(
      result.report.transactionMessageSha256,
      messageSha
    );
  }
);

test(
  'confirmation phrase includes plan, artifact, amount, and mint',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { storedArtifact } =
      await createPlanWithArtifact('plan-preview-confirm', 'instance-preview-confirm');

    const result = runPreview('plan-preview-confirm', '--json');

    assert.equal(result.status, 0);
    assert.ok(result.report);

    const phrase = result.report.confirmationPhrase as string;

    assert.ok(phrase.includes('plan-preview-confirm'));
    assert.ok(phrase.includes(storedArtifact.artifactId));
    assert.ok(phrase.includes(BUY_LAMPORTS));
    assert.ok(phrase.includes(EXACT_MINT));
    assert.ok(phrase.startsWith('CONFIRM:'));
  }
);

test(
  'modified artifact rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createPlanWithArtifact('plan-preview-modified', 'instance-preview-modified');

    /*
     * Tamper with the artifact file.
     */
    const { loadSimulationArtifact, getSimulationArtifactPath } = await import(
      '../sniper/simulation-artifact-store.js'
    );

    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    const plan = await loadApprovedExecutionPlan('plan-preview-modified');
    const artifactId = plan.state.simulationReceipt!.artifactId!;
    const artifactPath = getSimulationArtifactPath(artifactId);

    const content = await readFile(artifactPath, 'utf8');
    const parsed = JSON.parse(content);

    /*
     * Modify the serialized transaction bytes.
     */
    parsed.serializedTransactionBase64 = Buffer.from('tampered').toString('base64');

    /*
     * Recompute the artifact hash.
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

    const { artifactSha256, ...body } = parsed;
    parsed.artifactSha256 = createHash('sha256')
      .update(stableStr(body))
      .digest('hex');

    await writeFile(artifactPath, JSON.stringify(parsed, null, 2), 'utf8');

    const result = runPreview('plan-preview-modified');

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /hash does not match receipt|invalid transaction/i
    );
  }
);

test(
  'wrong fee payer rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Create a plan with an artifact whose fee payer
     * doesn't match the receipt's walletPublicKey.
     */
    const { createHash } = await import('node:crypto');
    const { getApprovedExecutionPlanPath } = await import(
      '../sniper/execution-plan.js'
    );
    const { persistSimulationArtifact } = await import(
      '../sniper/simulation-artifact-store.js'
    );

    const {
      VersionedTransaction,
      MessageV0,
      PublicKey,
      TransactionInstruction,
    } = await import('@solana/web3.js');

    const wrongPayer = new PublicKey(
      '11111111111111111111111111111112'
    );

    const message = MessageV0.compile({
      payerKey: wrongPayer,
      instructions: [
        new TransactionInstruction({
          keys: [{ pubkey: wrongPayer, isSigner: true, isWritable: true }],
          programId: new PublicKey('11111111111111111111111111111113'),
          data: Buffer.alloc(0),
        }),
      ],
      recentBlockhash: '11111111111111111111111111111111',
      addressLookupTableAccounts: [],
    });

    const tx = new VersionedTransaction(message);
    const serializedTx = Buffer.from(tx.serialize());

    const serializedTxSha = createHash('sha256')
      .update(serializedTx)
      .digest('hex');

    const messageSha = createHash('sha256')
      .update(message.serialize())
      .digest('hex');

    const storedArtifact = await persistSimulationArtifact({
      planId: 'plan-preview-wrong-payer',
      planInstanceId: 'instance-preview-wrong-payer',
      planSha256BeforeSimulation: 'e'.repeat(64),
      serializedTransaction: serializedTx,
      simulationResponse: { contextSlot: 1, err: null, logs: [] },
      createdAt: new Date().toISOString(),
    });

    const state = {
      status: 'simulated' as const,
      simulationCount: 1,
      createdAt: new Date().toISOString(),
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
        artifactId: storedArtifact.artifactId,
        artifactSha256: storedArtifact.artifactSha256,
      },
    };

    const payload = {
      signature: 'sig-wrong-payer',
      exactMint: EXACT_MINT,
      createdAt: new Date().toISOString(),
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
          planId: 'plan-preview-wrong-payer',
          planInstanceId: 'instance-preview-wrong-payer',
          state,
          payload,
        })
      )
      .digest('hex');

    const path = getApprovedExecutionPlanPath('plan-preview-wrong-payer');
    await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
    await writeFile(
      path,
      JSON.stringify(
        {
          version: 3,
          planId: 'plan-preview-wrong-payer',
          planInstanceId: 'instance-preview-wrong-payer',
          state,
          payload,
          sha256: hash,
        },
        null,
        2
      ),
      'utf8'
    );

    const result = runPreview('plan-preview-wrong-payer');

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /fee payer does not match receipt/i
    );
  }
);

test(
  'non-simulated plan rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Write a plan with status 'prepared'.
     */
    const { createHash } = await import('node:crypto');
    const { getApprovedExecutionPlanPath } = await import(
      '../sniper/execution-plan.js'
    );

    const state = {
      status: 'prepared',
      simulationCount: 0,
      createdAt: new Date().toISOString(),
    };

    const payload = {
      signature: 'sig-prepared',
      exactMint: EXACT_MINT,
      createdAt: new Date().toISOString(),
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
          planId: 'plan-preview-prepared',
          planInstanceId: 'instance-preview-prepared',
          state,
          payload,
        })
      )
      .digest('hex');

    const path = getApprovedExecutionPlanPath('plan-preview-prepared');
    await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
    await writeFile(
      path,
      JSON.stringify(
        {
          version: 3,
          planId: 'plan-preview-prepared',
          planInstanceId: 'instance-preview-prepared',
          state,
          payload,
          sha256: hash,
        },
        null,
        2
      ),
      'utf8'
    );

    const result = runPreview('plan-preview-prepared');

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /not simulated/i
    );
  }
);

test(
  'preview source contains no signing call',
  async () => {
    const source = await readFile(
      join(process.cwd(), 'sniper', 'preview-verified-execution.ts'),
      'utf8'
    );

    assert.doesNotMatch(source, /\.sign\(/);
    assert.doesNotMatch(source, /signVerifiedSimulationTransaction/);
  }
);

test(
  'preview source contains no send call',
  async () => {
    const source = await readFile(
      join(process.cwd(), 'sniper', 'preview-verified-execution.ts'),
      'utf8'
    );

    assert.doesNotMatch(source, /sendRawTransaction/);
    assert.doesNotMatch(source, /sendExactTransaction/);
  }
);

test(
  'JSON output contains no private key or raw transaction bytes',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createPlanWithArtifact('plan-preview-redact', 'instance-preview-redact');

    const result = runPreview('plan-preview-redact', '--json');

    assert.equal(result.status, 0);

    const output = result.stdout + result.stderr;

    assert.doesNotMatch(output, /privateKey|secretKey|seed/i);
    assert.doesNotMatch(output, /serializedTransactionBase64/);
  }
);
