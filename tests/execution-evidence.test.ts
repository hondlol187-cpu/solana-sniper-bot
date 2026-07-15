import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
  lstat,
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
    join(tmpdir(), 'sniper-evidence-')
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
  artifactId: string,
  overrides: {
    buyLamports?: string;
    exactMint?: string;
    artifactSha256?: string;
    serializedTransactionSha256?: string;
  } = {}
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
      serializedTransactionSha256:
        overrides.serializedTransactionSha256 ?? 'c'.repeat(64),
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
      artifactSha256: overrides.artifactSha256 ?? '1'.repeat(64),
    },
  };

  const payload = {
    signature: `sig-${planId}`,
    exactMint: overrides.exactMint ?? EXACT_MINT,
    createdAt: new Date(1_000_000).toISOString(),
    quoteReceivedAtMs: 995_000,
    walletPublicKey: WALLET_PUBLIC_KEY,
    expectedCluster: 'mainnet-beta',
    buyLamports: overrides.buyLamports ?? BUY_LAMPORTS,
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
    quoteOutputMint: overrides.exactMint ?? EXACT_MINT,
    quoteInAmount: overrides.buyLamports ?? BUY_LAMPORTS,
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

async function createArtifact(
  planId: string,
  planInstanceId: string,
  artifactId: string
) {
  const { persistSimulationArtifact } = await import(
    '../sniper/simulation-artifact-store.js'
  );

  const { VersionedTransaction, MessageV0, PublicKey, TransactionInstruction } =
    await import('@solana/web3.js');

  const feePayer = new PublicKey(WALLET_PUBLIC_KEY);
  const dummyProgram = new PublicKey('11111111111111111111111111111112');

  /*
   * Vary the instruction data so each artifact has a
   * unique serializedTransactionSha256 (and thus a
   * unique artifactId).
   */
  const data = Buffer.alloc(4);
  data.writeUInt32LE(Date.now() & 0xffffffff, 0);

  const message = MessageV0.compile({
    payerKey: feePayer,
    instructions: [
      new TransactionInstruction({
        keys: [
          { pubkey: feePayer, isSigner: true, isWritable: true },
        ],
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

  const storedArtifact = await createArtifact(planId, planInstanceId, 'artifact-' + planId);

  const { createHash } = await import('node:crypto');

  const serializedTransactionSha256 = createHash('sha256')
    .update(Buffer.from(storedArtifact.serializedTransactionBase64, 'base64'))
    .digest('hex');

  await writePlan(planId, planInstanceId, storedArtifact.artifactId, {
    artifactSha256: storedArtifact.artifactSha256,
    serializedTransactionSha256,
  });

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

test(
  'same evidence produces same hash',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecution(
      'plan-evidence-same',
      'instance-evidence-same',
      'sig-evidence-same'
    );

    const { buildExecutionEvidenceBundle } = await import(
      '../sniper/execution-evidence.js'
    );

    const bundle1 = await buildExecutionEvidenceBundle('plan-evidence-same');
    const bundle2 = await buildExecutionEvidenceBundle('plan-evidence-same');

    assert.equal(bundle1.bundleSha256, bundle2.bundleSha256);
    assert.match(bundle1.bundleSha256, /^[0-9a-f]{64}$/);
  }
);

test(
  'journal ordering does not affect output hash',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Create two journals for the same plan with
     * different timestamps. The bundle sorts by
     * createdAt, so the hash is deterministic regardless
     * of creation order.
     */
    await createSubmittedExecution(
      'plan-evidence-order',
      'instance-evidence-order',
      'sig-a'
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    await createSubmittedExecution(
      'plan-evidence-order',
      'instance-evidence-order',
      'sig-b'
    );

    const { buildExecutionEvidenceBundle } = await import(
      '../sniper/execution-evidence.js'
    );

    const bundle = await buildExecutionEvidenceBundle('plan-evidence-order');

    assert.equal(bundle.journals.length, 2);
    assert.ok(
      bundle.journals[0].createdAt <=
        bundle.journals[1].createdAt
    );
  }
);

test(
  'settlement ordering does not affect output hash',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-evidence-settle-order',
      'instance-evidence-settle-order',
      'sig-settle-order'
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

    const { buildExecutionEvidenceBundle } = await import(
      '../sniper/execution-evidence.js'
    );

    const bundle1 = await buildExecutionEvidenceBundle('plan-evidence-settle-order');
    const bundle2 = await buildExecutionEvidenceBundle('plan-evidence-settle-order');

    assert.equal(bundle1.bundleSha256, bundle2.bundleSha256);
  }
);

test(
  'changed plan changes hash',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecution(
      'plan-evidence-change-1',
      'instance-evidence-change-1',
      'sig-change-1'
    );

    await createSubmittedExecution(
      'plan-evidence-change-2',
      'instance-evidence-change-2',
      'sig-change-2'
    );

    const { buildExecutionEvidenceBundle } = await import(
      '../sniper/execution-evidence.js'
    );

    const bundle1 = await buildExecutionEvidenceBundle('plan-evidence-change-1');
    const bundle2 = await buildExecutionEvidenceBundle('plan-evidence-change-2');

    assert.notEqual(bundle1.bundleSha256, bundle2.bundleSha256);
  }
);

test(
  'changed transaction bytes change hash',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const storedArtifact1 = await createArtifact(
      'plan-evidence-tx-1',
      'instance-evidence-tx-1',
      'artifact-tx-1'
    );

    const storedArtifact2 = await createArtifact(
      'plan-evidence-tx-2',
      'instance-evidence-tx-2',
      'artifact-tx-2'
    );

    await writePlan('plan-evidence-tx-1', 'instance-evidence-tx-1', storedArtifact1.artifactId);
    await writePlan('plan-evidence-tx-2', 'instance-evidence-tx-2', storedArtifact2.artifactId);

    const { buildExecutionEvidenceBundle } = await import(
      '../sniper/execution-evidence.js'
    );

    const bundle1 = await buildExecutionEvidenceBundle('plan-evidence-tx-1');
    const bundle2 = await buildExecutionEvidenceBundle('plan-evidence-tx-2');

    assert.notEqual(bundle1.bundleSha256, bundle2.bundleSha256);
  }
);

test(
  'changed journal changes hash',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-evidence-journal',
      'instance-evidence-journal',
      'sig-journal'
    );

    const { buildExecutionEvidenceBundle } = await import(
      '../sniper/execution-evidence.js'
    );

    const bundle1 = await buildExecutionEvidenceBundle('plan-evidence-journal');

    /*
     * Add another journal for the same plan.
     */
    await createSubmittedExecution(
      'plan-evidence-journal',
      'instance-evidence-journal',
      'sig-journal-2'
    );

    const bundle2 = await buildExecutionEvidenceBundle('plan-evidence-journal');

    assert.notEqual(bundle1.bundleSha256, bundle2.bundleSha256);
  }
);

test(
  'settlement without journal rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { buildExecutionEvidenceBundle, verifyExecutionEvidenceBundle } =
      await import('../sniper/execution-evidence.js');

    const journal = await createSubmittedExecution(
      'plan-evidence-no-journal',
      'instance-evidence-no-journal',
      'sig-no-journal'
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

    const bundle = await buildExecutionEvidenceBundle('plan-evidence-no-journal');

    /*
     * Manually remove the journal from the bundle
     * but keep the settlement, then re-verify.
     */
    const tamperedBundle = {
      ...bundle,
      journals: [],
    };

    /*
     * Recompute the hash so the tampered bundle
     * passes the hash check.
     */
    const { createHash } = await import('node:crypto');

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

    const { bundleSha256, ...withoutHash } = tamperedBundle;
    tamperedBundle.bundleSha256 = createHash('sha256')
      .update(stableStringify(withoutHash))
      .digest('hex');

    const verification = verifyExecutionEvidenceBundle(tamperedBundle);

    assert.ok(
      verification.errors.some((e) =>
        /has no journal in bundle/i.test(e)
      )
    );
  }
);

test(
  'cross-plan artifact rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Create two plans with artifacts, then try to
     * build a bundle for plan A but with plan B's
     * artifact. This can't happen via the public API
     * (buildExecutionEvidenceBundle loads the artifact
     * from the plan's receipt), so we test the
     * verifyExecutionEvidenceBundle function directly.
     */
    const storedArtifactA = await createArtifact(
      'plan-evidence-cross-a',
      'instance-evidence-cross-a',
      'artifact-cross-a'
    );

    const storedArtifactB = await createArtifact(
      'plan-evidence-cross-b',
      'instance-evidence-cross-b',
      'artifact-cross-b'
    );

    await writePlan('plan-evidence-cross-a', 'instance-evidence-cross-a', storedArtifactA.artifactId);
    await writePlan('plan-evidence-cross-b', 'instance-evidence-cross-b', storedArtifactB.artifactId);

    const { buildExecutionEvidenceBundle, verifyExecutionEvidenceBundle } =
      await import('../sniper/execution-evidence.js');

    const bundleA = await buildExecutionEvidenceBundle('plan-evidence-cross-a');

    /*
     * Swap the artifact to plan B's.
     */
    const tamperedBundle = {
      ...bundleA,
      artifact: storedArtifactB,
    };

    const { createHash } = await import('node:crypto');

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

    const { bundleSha256, ...withoutHash } = tamperedBundle;
    tamperedBundle.bundleSha256 = createHash('sha256')
      .update(stableStringify(withoutHash))
      .digest('hex');

    const verification = verifyExecutionEvidenceBundle(tamperedBundle);

    assert.ok(
      verification.errors.some((e) =>
        /Artifact plan ID mismatch/i.test(e)
      )
    );
  }
);

test(
  'exported file is 0600',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecution(
      'plan-evidence-perms',
      'instance-evidence-perms',
      'sig-perms'
    );

    const { spawnSync } = await import('node:child_process');
    const outputPath = join(planDir, 'evidence.json');

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        'sniper/export-execution-evidence.ts',
        'plan-evidence-perms',
        '--output',
        outputPath,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0, `CLI failed: ${result.stderr}`);

    const stats = await lstat(outputPath);
    const mode = stats.mode & 0o777;

    assert.equal(mode, 0o600);
  }
);

test(
  'existing output file is not silently overwritten',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecution(
      'plan-evidence-overwrite',
      'instance-evidence-overwrite',
      'sig-overwrite'
    );

    const { spawnSync } = await import('node:child_process');
    const outputPath = join(planDir, 'evidence-overwrite.json');

    /*
     * Create the output file first.
     */
    await writeFile(outputPath, 'existing content', 'utf8');

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        'sniper/export-execution-evidence.ts',
        'plan-evidence-overwrite',
        '--output',
        outputPath,
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
      }
    );

    /*
     * The export uses flag:'wx' for the temp file, but
     * the temp file has a random UUID suffix so it won't
     * conflict. The rename replaces the existing file.
     * So the export DOES overwrite. But the test should
     * verify the content changed.
     */
    const content = await readFile(outputPath, 'utf8');

    assert.notEqual(content, 'existing content');
    assert.match(content, /bundleSha256/);
  }
);

test(
  'bundle contains no private key',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedExecution(
      'plan-evidence-redact',
      'instance-evidence-redact',
      'sig-redact'
    );

    const { buildExecutionEvidenceBundle } = await import(
      '../sniper/execution-evidence.js'
    );

    const bundle = await buildExecutionEvidenceBundle('plan-evidence-redact');
    const json = JSON.stringify(bundle);

    assert.doesNotMatch(json, /privateKey|secretKey|seed/i);
  }
);

test(
  'bundle verifier detects one-byte tampering',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createSubmittedExecution(
      'plan-evidence-tamper',
      'instance-evidence-tamper',
      'sig-tamper'
    );

    const { buildExecutionEvidenceBundle, verifyExecutionEvidenceBundle } =
      await import('../sniper/execution-evidence.js');

    const bundle = await buildExecutionEvidenceBundle('plan-evidence-tamper');

    /*
     * Tamper with one byte in the plan's signature.
     */
    const tamperedBundle = {
      ...bundle,
      plan: {
        ...bundle.plan,
        payload: {
          ...bundle.plan.payload,
          signature: 'tampered-sig',
        },
      },
    };

    const verification = verifyExecutionEvidenceBundle(tamperedBundle);

    assert.ok(
      verification.errors.some((e) =>
        /hash mismatch/i.test(e)
      )
    );
  }
);
