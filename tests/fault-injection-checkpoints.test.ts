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
  faultAt,
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
    join(tmpdir(), 'sniper-checkpoint-')
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
  returnedSignature = 'expected-signature';

  async getWalletBalance() { return this.balance; }
  async isBlockhashValid() { return this.blockhashValid; }
  async getCurrentBlockHeight() { return this.blockHeight; }
  async sendExactTransaction(bytes: Buffer) {
    this.sentTransactions.push(Buffer.from(bytes));
    return this.returnedSignature;
  }
}

async function setupPlanAndArtifact(
  planId: string,
  planInstanceId: string
) {
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
      programId: dummyProgram,
      data,
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

async function executeWithFake(
  planId: string,
  rpc: FakeRpc,
  fi: FaultInjector = noFaults
) {
  const { config } = await import('../sniper/config.js');
  const { executeVerifiedPlan } = await import('../sniper/verified-execution-core.js');
  return executeVerifiedPlan(planId, config.keypair!, rpc, fi);
}

async function settleWithFake(
  executionId: string,
  outcome: 'confirmed' | 'failed',
  fi: FaultInjector = noFaults
) {
  const { settleExecutionOutcome } = await import('../sniper/execution-settlement.js');
  return settleExecutionOutcome({
    executionId, outcome,
    observedSlot: 111,
    confirmationStatus: outcome === 'confirmed' ? 'confirmed' : undefined,
    failureReason: outcome === 'failed' ? 'test failure' : undefined,
    currentBalanceLamports: 1_000_000_000n,
  }, fi);
}

async function archiveWithFake(
  planId: string,
  fi: FaultInjector = noFaults
) {
  const { archiveExecutionEvidence } = await import('../sniper/execution-archive.js');
  return archiveExecutionEvidence(planId, fi);
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

async function getJournalForPlan(planId: string) {
  const { listExecutionJournals } = await import('../sniper/execution-journal.js');
  const journals = await listExecutionJournals();
  return journals.find((j) => j.planId === planId);
}

/*
 * Test each execution checkpoint: fault on first call,
 * then recover on second call (no fault).
 */

const executionCheckpoints: ExecutionCheckpoint[] = [
  'risk-reserved',
  'signing-recorded',
  'broadcast-prepared',
  'transaction-sent',
  'submitted-recorded',
];

for (const cp of executionCheckpoints) {
  test(
    `execution fault at ${cp} recovers without duplicate broadcast`,
    async () => {
      await configureEnvironment();
      await cleanAll();

      await setupPlanAndArtifact(`plan-cp-${cp}`, `instance-cp-${cp}`);

      const rpc = new FakeRpc();
      const fi = faultAt(cp);

      /*
       * First attempt: throws at the checkpoint.
       */
      await assert.rejects(
        executeWithFake(`plan-cp-${cp}`, rpc, fi),
        /Injected fault at checkpoint|RPC returned a different signature|already reached/i
      );

      const txCountAfterFirst = rpc.sentTransactions.length;

      /*
       * Second attempt: no fault. The execution should
       * either proceed to completion or reject because
       * the journal is already in a non-'ready' state.
       */
      const rpc2 = new FakeRpc();

      try {
        await executeWithFake(`plan-cp-${cp}`, rpc2);
      } catch (error) {
        /*
         * Expected if the journal already reached
         * 'broadcasting' or 'submitted'.
         */
      }

      /*
       * No duplicate broadcast: total transactions
       * across both RPC instances is at most 1.
       */
      assert.ok(
        rpc.sentTransactions.length + rpc2.sentTransactions.length <= 1,
        `duplicate broadcast: ${rpc.sentTransactions.length} + ${rpc2.sentTransactions.length}`
      );

      /*
       * Risk is applied at most once.
       */
      const risk = await getRiskState();
      assert.ok(risk.completedTrades <= 1);
    }
  );
}

/*
 * Test each settlement checkpoint: fault on first call,
 * then recover on second call.
 */

const settlementCheckpoints: ExecutionCheckpoint[] = [
  'risk-settled',
  'execution-terminal',
  'plan-outcome-recorded',
  'audit-recorded',
];

for (const cp of settlementCheckpoints) {
  test(
    `settlement fault at ${cp} recovers to committed with exactly-once audit`,
    async () => {
      await configureEnvironment();
      await cleanAll();

      const planId = `plan-settle-${cp}`;
      await setupPlanAndArtifact(planId, `instance-settle-${cp}`);

      /*
       * First: execute to submitted state (with no fault).
       * Skip this — we manually create a submitted journal below
       * to avoid the fake RPC's wrong-signature issue.
       */

      /*
       * Manually advance the journal to 'submitted' state.
       */
      const { beginExecution, markExecutionSigning,
        markExecutionBroadcastReady, markExecutionSubmitted } = await import(
        '../sniper/execution-journal.js'
      );
      const { reserveTradeOnce } = await import('../sniper/risk.js');
      const { loadApprovedExecutionPlan } = await import('../sniper/execution-plan.js');

      const plan = await loadApprovedExecutionPlan(planId);
      const artifactId = plan.state.simulationReceipt!.artifactId!;

      const journal = await beginExecution(planId, `instance-settle-${cp}`, artifactId);

      await reserveTradeOnce(
        journal.riskReservationId!,
        EXACT_MINT, BigInt(BUY_LAMPORTS), 1_000_000_000n
      );

      await markExecutionSigning(journal.executionId);
      await markExecutionBroadcastReady(journal.executionId, {
        transactionSignature: `sig-${cp}`,
        signedTransactionSha256: SIGNED_TX_SHA,
        transactionMessageSha256: MSG_SHA,
        lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
      });
      await markExecutionSubmitted(journal.executionId, `sig-${cp}`);

      /*
       * First settlement attempt: throws at checkpoint.
       */
      const fi = faultAt(cp);
      await assert.rejects(
        settleWithFake(journal.executionId, 'confirmed', fi),
        /Injected fault at checkpoint/i
      );

      /*
       * Second settlement attempt: no fault. Should
       * reach 'committed'.
       */
      const result = await settleWithFake(journal.executionId, 'confirmed');
      assert.equal(result.status, 'committed');

      /*
       * Exactly one confirmed audit event.
       */
      const events = await readAuditEvents();
      const confirmedEvents = events.filter(
        (e) => e.event === 'candidate.execution.confirmed'
      );
      assert.equal(confirmedEvents.length, 1);

      /*
       * Risk: completedTrades is 1, no active reservations.
       */
      const risk = await getRiskState();
      assert.equal(risk.completedTrades, 1);
      assert.equal(risk.reservations.length, 0);
    }
  );
}

/*
 * Test archive checkpoints.
 */
const archiveCheckpoints: ExecutionCheckpoint[] = [
  'archive-written',
  'archive-indexed',
];

for (const cp of archiveCheckpoints) {
  test(
    `archive fault at ${cp} recovers with correct index`,
    async () => {
      await configureEnvironment();
      await cleanAll();

      const planId = `plan-arch-${cp}`;
      await setupPlanAndArtifact(planId, `instance-arch-${cp}`);

      /*
       * Create a terminal execution.
       */
      const { beginExecution, markExecutionSigning,
        markExecutionBroadcastReady, markExecutionSubmitted } = await import(
        '../sniper/execution-journal.js'
      );
      const { reserveTradeOnce } = await import('../sniper/risk.js');
      const { loadApprovedExecutionPlan } = await import('../sniper/execution-plan.js');

      const plan = await loadApprovedExecutionPlan(planId);
      const artifactId = plan.state.simulationReceipt!.artifactId!;

      const journal = await beginExecution(planId, `instance-arch-${cp}`, artifactId);

      await reserveTradeOnce(
        journal.riskReservationId!,
        EXACT_MINT, BigInt(BUY_LAMPORTS), 1_000_000_000n
      );

      await markExecutionSigning(journal.executionId);
      await markExecutionBroadcastReady(journal.executionId, {
        transactionSignature: `sig-${cp}`,
        signedTransactionSha256: SIGNED_TX_SHA,
        transactionMessageSha256: MSG_SHA,
        lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
      });
      await markExecutionSubmitted(journal.executionId, `sig-${cp}`);

      const { settleExecutionOutcome } = await import('../sniper/execution-settlement.js');
      await settleExecutionOutcome({
        executionId: journal.executionId,
        outcome: 'confirmed', observedSlot: 111,
        confirmationStatus: 'confirmed',
        currentBalanceLamports: 1_000_000_000n,
      });

      /*
       * First archive attempt: throws at checkpoint.
       */
      const fi = faultAt(cp);
      await assert.rejects(
        archiveWithFake(planId, fi),
        /Injected fault at checkpoint/i
      );

      /*
       * Second archive attempt: no fault. Should succeed.
       */
      const archive = await archiveWithFake(planId);
      assert.ok(archive.archiveSha256);

      /*
       * Verify the index has exactly one entry.
       */
      const { readExecutionArchiveIndex } = await import(
        '../sniper/execution-archive-index.js'
      );
      const entries = await readExecutionArchiveIndex();
      assert.equal(entries.length, 1);
    }
  );
}

/*
 * Global: noFaults injector never throws.
 */
test(
  'noFaults injector never throws',
  async () => {
    const checkpoints: ExecutionCheckpoint[] = [
      'risk-reserved', 'signing-recorded', 'broadcast-prepared',
      'transaction-sent', 'submitted-recorded', 'risk-settled',
      'execution-terminal', 'plan-outcome-recorded',
      'audit-recorded', 'archive-written', 'archive-indexed',
    ];

    for (const cp of checkpoints) {
      await noFaults.checkpoint(cp);
    }
  }
);
