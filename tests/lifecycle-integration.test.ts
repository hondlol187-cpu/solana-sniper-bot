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

import {
  Keypair,
  VersionedTransaction,
  MessageV0,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';

import type {
  VerifiedExecutionRpc,
} from '../sniper/verified-execution-rpc.js';

import {
  noFaults,
} from '../sniper/fault-injection.js';

import type {
  FaultInjector,
  ExecutionCheckpoint,
} from '../sniper/fault-injection.js';

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
    join(tmpdir(), 'sniper-lifecycle-')
  );

  planDir = join(dir, 'plans');
  riskFile = join(dir, 'risk.json');
  auditFile = join(dir, 'audit.jsonl');

  const keypair = Keypair.generate();
  const keyFilePath = join(dir, 'key.json');

  await writeFile(
    keyFilePath,
    JSON.stringify(Array.from(keypair.secretKey)),
    { encoding: 'utf8', mode: 0o600 }
  );

  const { chmod } = await import('node:fs/promises');
  await chmod(keyFilePath, 0o600);

  process.env.LIVE_TRADING = 'true';
  process.env.ENABLE_MAINNET_EXECUTION = 'true';
  process.env.PRIVATE_KEY_FILE = keyFilePath;
  process.env.WALLET_PUBLIC_KEY = keypair.publicKey.toBase58();
  process.env.RPC_URL = 'https://api.mainnet-beta.solana.com';
  process.env.OUTPUT_MINT = 'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_DIR = planDir;
  process.env.RISK_FILE = riskFile;
  process.env.AUDIT_FILE = auditFile;
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS = '30';
  process.env.MAX_DAILY_SPEND_SOL = '0.2';
  process.env.MAX_DAILY_TRADES = '3';
  process.env.MAX_DAILY_DRAWDOWN_SOL = '0.1';
  process.env.MAX_LIVE_EXECUTION_LAMPORTS = '100000000';
  process.env.MAX_LIVE_EXECUTION_RECEIPT_AGE_SECONDS = '30';
  process.env.MINIMUM_FEE_RESERVE_LAMPORTS = '1000000';

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

class FakeRpc implements VerifiedExecutionRpc {
  balance = 1_000_000_000n;
  blockhashValid = true;
  blockHeight = 100;
  sentTransactions: Buffer[] = [];

  async getWalletBalance() { return this.balance; }
  async isBlockhashValid() { return this.blockhashValid; }
  async getCurrentBlockHeight() { return this.blockHeight; }
  async sendExactTransaction(bytes: Buffer): Promise<string> {
    this.sentTransactions.push(Buffer.from(bytes));
    throw new Error('RPC returned a different signature');
  }
}

async function setupPlanAndArtifact(planId: string, planInstanceId: string) {
  const { config } = await import('../sniper/config.js');
  const signer = config.keypair!;
  const { createHash } = await import('node:crypto');
  const { getApprovedExecutionPlanPath } = await import('../sniper/execution-plan.js');
  const { persistSimulationArtifact } = await import('../sniper/simulation-artifact-store.js');

  const wallet = signer.publicKey.toBase58();
  const dummyProgram = new PublicKey('11111111111111111111111111111112');
  const data = Buffer.alloc(4);
  data.writeUInt32LE(Date.now() & 0xffffffff, 0);

  const message = MessageV0.compile({
    payerKey: signer.publicKey,
    instructions: [new TransactionInstruction({
      keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: true }],
      programId: dummyProgram, data,
    })],
    recentBlockhash: '11111111111111111111111111111111',
    addressLookupTableAccounts: [],
  });

  const tx = new VersionedTransaction(message);
  const serializedTx = Buffer.from(tx.serialize());
  const serializedTxSha = createHash('sha256').update(serializedTx).digest('hex');
  const messageSha = createHash('sha256').update(message.serialize()).digest('hex');

  const stored = await persistSimulationArtifact({
    planId, planInstanceId,
    planSha256BeforeSimulation: 'e'.repeat(64),
    serializedTransaction: serializedTx,
    simulationResponse: { contextSlot: 1, err: null, logs: [] },
    createdAt: new Date().toISOString(),
  });

  const state = {
    status: 'simulated' as const, simulationCount: 1,
    createdAt: new Date(Date.now() - 1_000).toISOString(),
    simulatedAt: new Date().toISOString(),
    simulationReceipt: {
      transactionMessageSha256: messageSha,
      serializedTransactionSha256: serializedTxSha,
      recentBlockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
      simulatedAt: new Date().toISOString(),
      rpcEndpoint: 'https://api.mainnet-beta.solana.com',
      contextSlot: 1, err: null, logsSha256: 'd'.repeat(64),
      walletPublicKey: wallet, expectedCluster: 'mainnet-beta',
      planSha256BeforeSimulation: 'e'.repeat(64),
      transactionPolicyOk: true, transactionPolicySha256: 'f'.repeat(64),
      artifactId: stored.artifactId, artifactSha256: stored.artifactSha256,
    },
  };

  const payload = {
    signature: `sig-${planId}`, exactMint: EXACT_MINT,
    createdAt: new Date(1_000_000).toISOString(),
    quoteReceivedAtMs: 995_000, walletPublicKey: wallet,
    expectedCluster: 'mainnet-beta', buyLamports: BUY_LAMPORTS,
    approvedPoolAddress: 'POOL_1',
    approvedQuoteMint: 'So11111111111111111111111111111111111111112',
    approvedLiquiditySol: 100, currentPoolAddress: 'POOL_1',
    currentQuoteMint: 'So11111111111111111111111111111111111111112',
    currentLiquiditySol: 90, routeHopCount: 1,
    routeLabels: ['Raydium AMM'], routeAmmKeys: ['POOL_1'],
    quoteInputMint: 'So11111111111111111111111111111111111111112',
    quoteOutputMint: EXACT_MINT, quoteInAmount: BUY_LAMPORTS,
    quoteOutAmount: '1000000', quoteOtherAmountThreshold: '900000',
    quoteSlippageBps: 150, quotePriceImpactPct: '0.5',
    quoteRoutePlan: [], routeOk: true, routeReasons: [],
    approvalOk: true, approvalReasons: [], quoteAgeMs: 100,
  };

  const hash = createHash('sha256')
    .update(stableStringify({ version: 3, planId, planInstanceId, state, payload }))
    .digest('hex');

  const path = getApprovedExecutionPlanPath(planId);
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(
    { version: 3, planId, planInstanceId, state, payload, sha256: hash }, null, 2
  ), 'utf8');

  return { stored, serializedTxSha, messageSha };
}

async function createSubmittedExecution(planId: string, planInstanceId: string) {
  const { beginExecution, markExecutionSigning,
    markExecutionBroadcastReady, markExecutionSubmitted } = await import(
    '../sniper/execution-journal.js'
  );
  const { reserveTradeOnce } = await import('../sniper/risk.js');
  const { loadApprovedExecutionPlan } = await import('../sniper/execution-plan.js');

  const plan = await loadApprovedExecutionPlan(planId);
  const artifactId = plan.state.simulationReceipt!.artifactId!;

  const journal = await beginExecution(planId, planInstanceId, artifactId);
  await reserveTradeOnce(journal.riskReservationId!, EXACT_MINT, BigInt(BUY_LAMPORTS), 1_000_000_000n);
  await markExecutionSigning(journal.executionId);
  await markExecutionBroadcastReady(journal.executionId, {
    transactionSignature: `sig-${planId}`,
    signedTransactionSha256: SIGNED_TX_SHA,
    transactionMessageSha256: MSG_SHA,
    lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
  });
  await markExecutionSubmitted(journal.executionId, `sig-${planId}`);

  return journal;
}

async function settleConfirmed(executionId: string) {
  const { settleExecutionOutcome } = await import('../sniper/execution-settlement.js');
  return settleExecutionOutcome({
    executionId, outcome: 'confirmed',
    observedSlot: 111, confirmationStatus: 'confirmed',
    currentBalanceLamports: 1_000_000_000n,
  });
}

async function settleFailed(executionId: string) {
  const { settleExecutionOutcome } = await import('../sniper/execution-settlement.js');
  return settleExecutionOutcome({
    executionId, outcome: 'failed',
    observedSlot: 222, failureReason: 'on-chain error',
    currentBalanceLamports: 1_000_000_000n,
  });
}

async function getRiskState() {
  const { getRiskState } = await import('../sniper/risk.js');
  return getRiskState(1_000_000_000n);
}

async function readAuditEvents() {
  try {
    const content = await readFile(auditFile, 'utf8');
    return content.trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string });
  } catch { return []; }
}

test(
  'successful confirmation lifecycle: artifact → execution → settlement → archive',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact('plan-life-success', 'instance-life-success');
    const journal = await createSubmittedExecution('plan-life-success', 'instance-life-success');

    /*
     * Settle as confirmed.
     */
    const settlement = await settleConfirmed(journal.executionId);
    assert.equal(settlement.status, 'committed');

    /*
     * Risk: 1 completed trade, 0 reservations.
     */
    const risk = await getRiskState();
    assert.equal(risk.completedTrades, 1);
    assert.equal(risk.reservations.length, 0);

    /*
     * Exactly-once audit.
     */
    const events = await readAuditEvents();
    const confirmedEvents = events.filter((e) => e.event === 'candidate.execution.confirmed');
    assert.equal(confirmedEvents.length, 1);

    /*
     * Plan outcome is recorded.
     */
    const { loadApprovedExecutionPlan } = await import('../sniper/execution-plan.js');
    const plan = await loadApprovedExecutionPlan('plan-life-success');
    assert.ok(plan.state.executionOutcome);
    assert.equal(plan.state.executionOutcome.outcome, 'confirmed');

    /*
     * Evidence bundle builds and verifies.
     */
    const { buildExecutionEvidenceBundle, verifyExecutionEvidenceBundle } = await import(
      '../sniper/execution-evidence.js'
    );
    const bundle = await buildExecutionEvidenceBundle('plan-life-success');
    const verification = verifyExecutionEvidenceBundle(bundle);
    assert.ok(verification.ok, verification.errors.join('; '));

    /*
     * Archive writes and indexes.
     */
    const { archiveExecutionEvidence } = await import('../sniper/execution-archive.js');
    const archive = await archiveExecutionEvidence('plan-life-success');
    assert.ok(archive.archiveSha256);

    const { readExecutionArchiveIndex } = await import('../sniper/execution-archive-index.js');
    const entries = await readExecutionArchiveIndex();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].planInstanceId, 'instance-life-success');
  }
);

test(
  'on-chain failure lifecycle: risk released, no completed trade',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact('plan-life-fail', 'instance-life-fail');
    const journal = await createSubmittedExecution('plan-life-fail', 'instance-life-fail');

    const settlement = await settleFailed(journal.executionId);
    assert.equal(settlement.status, 'committed');

    const risk = await getRiskState();
    assert.equal(risk.completedTrades, 0);
    assert.equal(risk.reservations.length, 0);

    const events = await readAuditEvents();
    const failedEvents = events.filter((e) => e.event === 'candidate.execution.failed');
    assert.equal(failedEvents.length, 1);
  }
);

test(
  'concurrent execution attempts: only one proceeds',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact('plan-life-concurrent', 'instance-life-concurrent');

    const { beginExecution } = await import('../sniper/execution-journal.js');
    const { loadApprovedExecutionPlan } = await import('../sniper/execution-plan.js');

    const plan = await loadApprovedExecutionPlan('plan-life-concurrent');
    const artifactId = plan.state.simulationReceipt!.artifactId!;

    /*
     * Two concurrent beginExecution calls — only one
     * creates the journal; the other gets the existing one.
     */
    const [j1, j2] = await Promise.all([
      beginExecution('plan-life-concurrent', 'instance-life-concurrent', artifactId),
      beginExecution('plan-life-concurrent', 'instance-life-concurrent', artifactId),
    ]);

    assert.equal(j1.executionId, j2.executionId);
  }
);

test(
  'RPC timeout after submission leaves broadcasting, no resend',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact('plan-life-timeout', 'instance-life-timeout');

    const rpc = new FakeRpc();

    const { config } = await import('../sniper/config.js');
    const { executeVerifiedPlan } = await import('../sniper/verified-execution-core.js');

    /*
     * Execute — the fake RPC always throws on send.
     */
    await assert.rejects(
      executeVerifiedPlan('plan-life-timeout', config.keypair!, rpc),
      /RPC returned a different signature|already reached/i
    );

    assert.equal(rpc.sentTransactions.length, 1);

    /*
     * Re-run — must not send another transaction.
     */
    const rpc2 = new FakeRpc();
    await assert.rejects(
      executeVerifiedPlan('plan-life-timeout', config.keypair!, rpc2),
      /already reached broadcasting|cannot start from/i
    );

    assert.equal(rpc2.sentTransactions.length, 0);
  }
);

test(
  'process restart at every checkpoint reaches terminal state',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const planId = 'plan-life-restart';
    const planInstanceId = 'instance-life-restart';

    await setupPlanAndArtifact(planId, planInstanceId);

    /*
     * Manually create a submitted journal (bypassing the
     * execution flow that requires a live RPC).
     */
    const journal = await createSubmittedExecution(planId, planInstanceId);

    /*
     * For each settlement checkpoint, fault on the first
     * call, then recover on the second.
     */
    const { faultAt } = await import('../sniper/fault-injection.js');
    const checkpoints: ExecutionCheckpoint[] = [
      'risk-settled',
      'execution-terminal',
      'plan-outcome-recorded',
      'audit-recorded',
    ];

    for (const cp of checkpoints) {
      const fi = faultAt(cp);

      const { settleExecutionOutcome } = await import('../sniper/execution-settlement.js');

      try {
        await settleExecutionOutcome({
          executionId: journal.executionId,
          outcome: 'confirmed', observedSlot: 111,
          confirmationStatus: 'confirmed',
          currentBalanceLamports: 1_000_000_000n,
        }, fi);
      } catch (error) {
        /*
         * Expected on first pass — the fault throws.
         * On subsequent passes, the settlement may
         * already be committed (idempotent).
         */
      }
    }

    /*
     * Final state: committed settlement, 1 audit event.
     */
    const { settleExecutionOutcome } = await import('../sniper/execution-settlement.js');
    const result = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed', observedSlot: 111,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: 1_000_000_000n,
    });

    assert.equal(result.status, 'committed');

    const events = await readAuditEvents();
    const confirmedEvents = events.filter((e) => e.event === 'candidate.execution.confirmed');
    assert.equal(confirmedEvents.length, 1);
  }
);

test(
  'tampered artifact is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { stored } = await setupPlanAndArtifact('plan-life-tamper-art', 'instance-life-tamper-art');

    /*
     * Tamper with the artifact file.
     */
    const { getSimulationArtifactPath } = await import('../sniper/simulation-artifact-store.js');
    const artifactPath = getSimulationArtifactPath(stored.artifactId);

    const content = await readFile(artifactPath, 'utf8');
    const parsed = JSON.parse(content);

    parsed.serializedTransactionBase64 = Buffer.from('tampered').toString('base64');

    const { createHash } = await import('node:crypto');
    const { artifactSha256, ...body } = parsed;
    parsed.artifactSha256 = createHash('sha256')
      .update(stableStringify(body))
      .digest('hex');

    await writeFile(artifactPath, JSON.stringify(parsed, null, 2), 'utf8');

    /*
     * Verify the evidence bundle detects the tampering.
     */
    const { buildExecutionEvidenceBundle, verifyExecutionEvidenceBundle } = await import(
      '../sniper/execution-evidence.js'
    );

    const journal = await createSubmittedExecution('plan-life-tamper-art', 'instance-life-tamper-art');
    await settleConfirmed(journal.executionId);

    let bundle;

    try {
      bundle = await buildExecutionEvidenceBundle('plan-life-tamper-art');
    } catch (error) {
      /*
       * The build itself may throw if the artifact
       * can't be loaded (tampered transaction bytes
       * fail VersionedTransaction.deserialize).
       */
      assert.match(
        error instanceof Error ? error.message : String(error),
        /invalid transaction|hash mismatch|does not match/i
      );
      return;
    }

    const verification = verifyExecutionEvidenceBundle(bundle);

    assert.ok(
      verification.errors.some((e) =>
        /transaction bytes do not match receipt|invalid transaction|Artifact validation failed/i.test(e)
      )
    );
  }
);

test(
  'expired blockhash rejects before broadcast',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact('plan-life-expired', 'instance-life-expired');

    const rpc = new FakeRpc();
    rpc.blockhashValid = false;

    const { config } = await import('../sniper/config.js');
    const { executeVerifiedPlan } = await import('../sniper/verified-execution-core.js');

    await assert.rejects(
      executeVerifiedPlan('plan-life-expired', config.keypair!, rpc),
      /blockhash is no longer valid/i
    );

    assert.equal(rpc.sentTransactions.length, 0);
  }
);
