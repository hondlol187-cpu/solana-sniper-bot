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
    join(tmpdir(), 'sniper-arch-index-')
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

function indexPath() {
  return join(planDir, 'execution-archives', 'index.jsonl');
}

async function readIndex() {
  return readFile(indexPath(), 'utf8');
}

async function tamperIndexLine(
  lineIndex: number,
  mutator: (entry: Record<string, unknown>) => void
) {
  const content = await readIndex();
  const lines = content.split('\n').filter((l) => l.trim());

  if (lineIndex >= lines.length) {
    throw new Error(`Line ${lineIndex} does not exist`);
  }

  const entry = JSON.parse(lines[lineIndex]);
  mutator(entry);

  /*
   * Always recompute entryHash after mutation so
   * the entry passes validateEntry's hash check.
   * The chain-linkage checks in verifyExecutionArchiveIndex
   * will detect the tampered previousHash or sequence.
   */
  const { createHash } = await import('node:crypto');
  const { entryHash, ...body } = entry;
  entry.entryHash = createHash('sha256')
    .update(stableStringify(body))
    .digest('hex');

  lines[lineIndex] = JSON.stringify(entry);

  await writeFile(indexPath(), lines.join('\n') + '\n', 'utf8');
}

test(
  'first archive receives sequence 1 and null previous hash',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-idx-1',
      'instance-idx-1',
      'confirmed'
    );

    await archivePlan('plan-idx-1');

    const { readExecutionArchiveIndex } = await import(
      '../sniper/execution-archive-index.js'
    );

    const entries = await readExecutionArchiveIndex();

    assert.equal(entries.length, 1);
    assert.equal(entries[0].sequence, 1);
    assert.equal(entries[0].previousHash, null);
    assert.equal(entries[0].planInstanceId, 'instance-idx-1');
  }
);

test(
  'second archive links to first',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-idx-2a',
      'instance-idx-2a',
      'confirmed'
    );

    await createTerminalExecution(
      'plan-idx-2b',
      'instance-idx-2b',
      'confirmed'
    );

    await archivePlan('plan-idx-2a');
    await archivePlan('plan-idx-2b');

    const { readExecutionArchiveIndex } = await import(
      '../sniper/execution-archive-index.js'
    );

    const entries = await readExecutionArchiveIndex();

    assert.equal(entries.length, 2);
    assert.equal(entries[1].sequence, 2);
    assert.equal(
      entries[1].previousHash,
      entries[0].entryHash
    );
  }
);

test(
  're-indexing same archive is idempotent',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-idx-idem',
      'instance-idx-idem',
      'confirmed'
    );

    await archivePlan('plan-idx-idem');
    await archivePlan('plan-idx-idem');

    const { readExecutionArchiveIndex } = await import(
      '../sniper/execution-archive-index.js'
    );

    const entries = await readExecutionArchiveIndex();

    assert.equal(entries.length, 1);
  }
);

test(
  'conflicting archive hash rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-idx-conflict',
      'instance-idx-conflict',
      'confirmed'
    );

    const { archiveExecutionEvidence, loadExecutionArchive } = await import(
      '../sniper/execution-archive.js'
    );

    await archivePlan('plan-idx-conflict');

    /*
     * Load the archive and tamper its archiveSha256.
     * Then try to re-index — the index entry's
     * archiveSha256 won't match.
     */
    const archive = await loadExecutionArchive('instance-idx-conflict');
    assert.ok(archive);

    const tamperedArchive = {
      ...archive,
      archiveSha256: '0'.repeat(64),
    };

    const { indexExecutionArchive } = await import(
      '../sniper/execution-archive-index.js'
    );

    await assert.rejects(
      indexExecutionArchive(tamperedArchive),
      /Conflicting archive index entry/i
    );
  }
);

test(
  'sequence tampering is detected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-idx-seq-a',
      'instance-idx-seq-a',
      'confirmed'
    );

    await createTerminalExecution(
      'plan-idx-seq-b',
      'instance-idx-seq-b',
      'confirmed'
    );

    await archivePlan('plan-idx-seq-a');
    await archivePlan('plan-idx-seq-b');

    /*
     * Tamper the second entry's sequence.
     */
    await tamperIndexLine(1, (entry) => {
      entry.sequence = 99;
    });

    const { verifyExecutionArchiveIndex } = await import(
      '../sniper/execution-archive-index.js'
    );

    const verification = await verifyExecutionArchiveIndex();

    assert.ok(
      verification.errors.some((e) =>
        /sequence mismatch/i.test(e)
      )
    );
  }
);

test(
  'previous-hash tampering is detected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-idx-prev-a',
      'instance-idx-prev-a',
      'confirmed'
    );

    await createTerminalExecution(
      'plan-idx-prev-b',
      'instance-idx-prev-b',
      'confirmed'
    );

    await archivePlan('plan-idx-prev-a');
    await archivePlan('plan-idx-prev-b');

    /*
     * Tamper the second entry's previousHash.
     */
    await tamperIndexLine(1, (entry) => {
      entry.previousHash = 'f'.repeat(64);
    });

    const { verifyExecutionArchiveIndex } = await import(
      '../sniper/execution-archive-index.js'
    );

    const verification = await verifyExecutionArchiveIndex();

    assert.ok(
      verification.errors.some((e) =>
        /previousHash mismatch/i.test(e)
      )
    );
  }
);

test(
  'entry-hash tampering is detected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-idx-entry',
      'instance-idx-entry',
      'confirmed'
    );

    await archivePlan('plan-idx-entry');

    /*
     * Tamper the entry's entryHash without
     * recomputing it.
     */
    const content = await readIndex();
    const lines = content.split('\n').filter((l) => l.trim());
    const entry = JSON.parse(lines[0]);

    entry.entryHash = 'a'.repeat(64);

    lines[0] = JSON.stringify(entry);
    await writeFile(indexPath(), lines.join('\n') + '\n', 'utf8');

    const { verifyExecutionArchiveIndex } = await import(
      '../sniper/execution-archive-index.js'
    );

    const verification = await verifyExecutionArchiveIndex();

    assert.ok(
      verification.errors.some((e) =>
        /entry hash mismatch/i.test(e)
      )
    );
  }
);

test(
  'duplicate plan instance is detected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-idx-dup',
      'instance-idx-dup',
      'confirmed'
    );

    await archivePlan('plan-idx-dup');

    /*
     * Manually append a duplicate entry to the index.
     */
    const { readExecutionArchiveIndex } = await import(
      '../sniper/execution-archive-index.js'
    );

    const entries = await readExecutionArchiveIndex();
    const lastEntry = entries[entries.length - 1];

    const { createHash } = await import('node:crypto');

    const dupBody = {
      sequence: lastEntry.sequence + 1,
      previousHash: lastEntry.entryHash,
      planId: lastEntry.planId,
      planInstanceId: lastEntry.planInstanceId,
      bundleSha256: lastEntry.bundleSha256,
      archiveSha256: lastEntry.archiveSha256,
      indexedAt: new Date().toISOString(),
    };

    const dupEntry = {
      ...dupBody,
      entryHash: createHash('sha256')
        .update(stableStringify(dupBody))
        .digest('hex'),
    };

    const { appendFile } = await import('node:fs/promises');
    await appendFile(
      indexPath(),
      `${JSON.stringify(dupEntry)}\n`,
      'utf8'
    );

    const { verifyExecutionArchiveIndex } = await import(
      '../sniper/execution-archive-index.js'
    );

    const verification = await verifyExecutionArchiveIndex();

    assert.ok(
      verification.errors.some((e) =>
        /duplicate plan instance/i.test(e)
      )
    );
  }
);

test(
  'crash after archive write can recover missing index',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-idx-crash',
      'instance-idx-crash',
      'confirmed'
    );

    /*
     * Archive the plan (which also indexes it).
     */
    await archivePlan('plan-idx-crash');

    /*
     * Delete the index file to simulate a crash
     * between archive write and index append.
     */
    await rm(indexPath(), { force: true });

    /*
     * Re-archive — the existing archive is found,
     * and indexExecutionArchive is called to
     * recover the missing index entry.
     */
    await archivePlan('plan-idx-crash');

    const { readExecutionArchiveIndex } = await import(
      '../sniper/execution-archive-index.js'
    );

    const entries = await readExecutionArchiveIndex();

    assert.equal(entries.length, 1);
    assert.equal(entries[0].planInstanceId, 'instance-idx-crash');
  }
);

test(
  'index mode is 0600',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-idx-mode',
      'instance-idx-mode',
      'confirmed'
    );

    await archivePlan('plan-idx-mode');

    const stats = await lstat(indexPath());
    const mode = stats.mode & 0o777;

    assert.equal(mode, 0o600);
  }
);

test(
  'concurrent archive indexing produces contiguous sequence',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createTerminalExecution(
      'plan-idx-conc-a',
      'instance-idx-conc-a',
      'confirmed'
    );

    await createTerminalExecution(
      'plan-idx-conc-b',
      'instance-idx-conc-b',
      'confirmed'
    );

    /*
     * Archive both concurrently. The file lock on
     * the index ensures sequential indexing.
     */
    await Promise.all([
      archivePlan('plan-idx-conc-a'),
      archivePlan('plan-idx-conc-b'),
    ]);

    const { readExecutionArchiveIndex } = await import(
      '../sniper/execution-archive-index.js'
    );

    const entries = await readExecutionArchiveIndex();

    assert.equal(entries.length, 2);
    assert.equal(entries[0].sequence, 1);
    assert.equal(entries[1].sequence, 2);
    assert.equal(
      entries[1].previousHash,
      entries[0].entryHash
    );
  }
);
