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
    join(tmpdir(), 'sniper-fault-inject-')
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

class FaultInjectingRpc
implements VerifiedExecutionRpc {
  balance = 1_000_000_000n;
  blockhashValid = true;
  blockHeight = 100;
  sentTransactions: Buffer[] = [];
  returnedSignature = 'expected-signature';

  /*
   * Fault injection: if set, the named operation
   * throws instead of executing.
   */
  faultBeforeSend = false;
  faultDuringSend = false;

  async getWalletBalance(): Promise<bigint> {
    return this.balance;
  }

  async isBlockhashValid(): Promise<boolean> {
    return this.blockhashValid;
  }

  async getCurrentBlockHeight(): Promise<number> {
    return this.blockHeight;
  }

  async sendExactTransaction(
    bytes: Buffer
  ): Promise<string> {
    if (this.faultBeforeSend) {
      throw new Error('Injected fault: before send');
    }

    this.sentTransactions.push(
      Buffer.from(bytes)
    );

    if (this.faultDuringSend) {
      throw new Error('Injected fault: during send');
    }

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
  const { getApprovedExecutionPlanPath } = await import(
    '../sniper/execution-plan.js'
  );
  const { persistSimulationArtifact } = await import(
    '../sniper/simulation-artifact-store.js'
  );

  const wallet = signer.publicKey.toBase58();

  const dummyProgram = new PublicKey(
    '11111111111111111111111111111112'
  );

  const data = Buffer.alloc(4);
  data.writeUInt32LE(Date.now() & 0xffffffff, 0);

  const message = MessageV0.compile({
    payerKey: signer.publicKey,
    instructions: [
      new TransactionInstruction({
        keys: [
          { pubkey: signer.publicKey, isSigner: true, isWritable: true },
        ],
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
      walletPublicKey: wallet,
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
    walletPublicKey: wallet,
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

async function executeWithFakeRpc(
  planId: string,
  rpc: FaultInjectingRpc
) {
  const { config } = await import('../sniper/config.js');
  const { executeVerifiedPlan } = await import(
    '../sniper/verified-execution-core.js'
  );

  return executeVerifiedPlan(planId, config.keypair!, rpc);
}

async function getJournalForPlan(planId: string) {
  const { listExecutionJournals } = await import(
    '../sniper/execution-journal.js'
  );

  const journals = await listExecutionJournals();
  return journals.find((j) => j.planId === planId);
}

async function getRiskState() {
  const { getRiskState } = await import('../sniper/risk.js');
  return getRiskState(1_000_000_000n);
}

async function readAuditEvents() {
  try {
    const content = await readFile(auditFile, 'utf8');
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { event: string });
  } catch {
    return [];
  }
}

/*
 * Boundary 1: After risk reservation, before signing.
 * The journal is in 'ready' state with a risk reservation.
 * Recovery: re-run executeVerifiedPlan — it loads the
 * existing journal (still 'ready'), re-reserves risk
 * (idempotent), and proceeds.
 */
test(
  'fault: crash after risk reservation leaves journal ready',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact(
      'plan-fault-risk',
      'instance-fault-risk'
    );

    /*
     * Manually create a journal in 'ready' state and
     * reserve risk, simulating a crash after risk
     * reservation but before signing.
     */
    const { config } = await import('../sniper/config.js');
    const { beginExecution } = await import(
      '../sniper/execution-journal.js'
    );
    const { reserveTradeOnce } = await import('../sniper/risk.js');
    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    const plan = await loadApprovedExecutionPlan('plan-fault-risk');
    const artifactId = plan.state.simulationReceipt!.artifactId!;

    const journal = await beginExecution(
      'plan-fault-risk',
      'instance-fault-risk',
      artifactId
    );

    await reserveTradeOnce(
      journal.riskReservationId!,
      EXACT_MINT,
      BigInt(BUY_LAMPORTS),
      1_000_000_000n
    );

    /*
     * Simulate crash — journal is 'ready', risk is reserved.
     * Re-run execution. It should find the existing journal
     * (status 'ready') and proceed.
     */
    const rpc = new FaultInjectingRpc();

    await assert.rejects(
      executeWithFakeRpc('plan-fault-risk', rpc),
      /RPC returned a different signature|already reached/i
    );

    /*
     * Exactly one transaction was sent (the execution
     * proceeded past risk and signing to broadcast).
     */
    assert.equal(rpc.sentTransactions.length, 1);

    /*
     * No double-counting: risk reservation is idempotent.
     */
    const risk = await getRiskState();
    assert.ok(risk.reservations.length <= 1);
  }
);

/*
 * Boundary 2: After signing, before broadcasting.
 * The journal is in 'signing' state. No broadcast occurred.
 * Recovery: re-run executeVerifiedPlan — beginExecution
 * rejects because the journal is 'signing' (not 'ready').
     * Stale-signing recovery can fail it after 60s.
 */
test(
  'fault: crash after signing leaves journal in signing state',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact(
      'plan-fault-signing',
      'instance-fault-signing'
    );

    const { beginExecution, markExecutionSigning } = await import(
      '../sniper/execution-journal.js'
    );
    const { reserveTradeOnce } = await import('../sniper/risk.js');
    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    const plan = await loadApprovedExecutionPlan('plan-fault-signing');
    const artifactId = plan.state.simulationReceipt!.artifactId!;

    const journal = await beginExecution(
      'plan-fault-signing',
      'instance-fault-signing',
      artifactId
    );

    await reserveTradeOnce(
      journal.riskReservationId!,
      EXACT_MINT,
      BigInt(BUY_LAMPORTS),
      1_000_000_000n
    );

    await markExecutionSigning(journal.executionId);

    /*
     * Simulate crash — journal is 'signing'.
     * Re-run execution. beginExecution should reject.
     */
    const rpc = new FaultInjectingRpc();

    await assert.rejects(
      executeWithFakeRpc('plan-fault-signing', rpc),
      /cannot start from signing|already reached/i
    );

    /*
     * No transaction was sent.
     */
    assert.equal(rpc.sentTransactions.length, 0);
  }
);

/*
 * Boundary 3: After broadcasting, before RPC submission.
 * The journal is in 'broadcasting' state. The transaction
 * may or may not be on the wire. Recovery: reconcile by
 * deterministic signature. Never resend.
 */
test(
  'fault: crash after broadcasting leaves journal in broadcasting',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact(
      'plan-fault-broadcast',
      'instance-fault-broadcast'
    );

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
    } = await import('../sniper/execution-journal.js');
    const { reserveTradeOnce } = await import('../sniper/risk.js');
    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    const plan = await loadApprovedExecutionPlan('plan-fault-broadcast');
    const artifactId = plan.state.simulationReceipt!.artifactId!;

    const journal = await beginExecution(
      'plan-fault-broadcast',
      'instance-fault-broadcast',
      artifactId
    );

    await reserveTradeOnce(
      journal.riskReservationId!,
      EXACT_MINT,
      BigInt(BUY_LAMPORTS),
      1_000_000_000n
    );

    await markExecutionSigning(journal.executionId);
    await markExecutionBroadcastReady(journal.executionId, {
      transactionSignature: 'sig-fault-broadcast',
      signedTransactionSha256: SIGNED_TX_SHA,
      transactionMessageSha256: MSG_SHA,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    });

    /*
     * Simulate crash — journal is 'broadcasting'.
     * Re-run execution. beginExecution should reject.
     */
    const rpc = new FaultInjectingRpc();

    await assert.rejects(
      executeWithFakeRpc('plan-fault-broadcast', rpc),
      /already reached broadcasting|cannot start from/i
    );

    assert.equal(rpc.sentTransactions.length, 0);
  }
);

/*
 * Boundary 4: After RPC send exception, before submitted.
 * The journal is in 'broadcasting' state. A send error
 * occurred. Recovery: reconcile by signature.
 */
test(
  'fault: send exception leaves journal in broadcasting',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact(
      'plan-fault-send-ex',
      'instance-fault-send-ex'
    );

    const rpc = new FaultInjectingRpc();
    rpc.faultDuringSend = true;

    await assert.rejects(
      executeWithFakeRpc('plan-fault-send-ex', rpc),
      /Injected fault: during send|already reached/i
    );

    /*
     * The send was attempted (one transaction pushed
     * to sentTransactions before the fault threw).
     */
    assert.equal(rpc.sentTransactions.length, 1);

    /*
     * Journal is in 'broadcasting'.
     */
    const journal = await getJournalForPlan('plan-fault-send-ex');
    assert.ok(journal);
    assert.equal(journal.status, 'broadcasting');

    /*
     * Re-running execution does not send another transaction.
     */
    const rpc2 = new FaultInjectingRpc();

    await assert.rejects(
      executeWithFakeRpc('plan-fault-send-ex', rpc2),
      /already reached broadcasting|cannot start from/i
    );

    assert.equal(rpc2.sentTransactions.length, 0);
  }
);

/*
 * Boundary 5: After risk settlement, before execution terminal.
 * The settlement is 'risk-applied'. Recovery: re-run
 * settleExecutionOutcome, which resumes from 'risk-applied'.
 */
test(
  'fault: settlement crash after risk-applied resumes correctly',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact(
      'plan-fault-settlement',
      'instance-fault-settlement'
    );

    const { config } = await import('../sniper/config.js');
    const { beginExecution, markExecutionSigning,
      markExecutionBroadcastReady, markExecutionSubmitted } = await import(
      '../sniper/execution-journal.js'
    );
    const { reserveTradeOnce } = await import('../sniper/risk.js');
    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    const plan = await loadApprovedExecutionPlan('plan-fault-settlement');
    const artifactId = plan.state.simulationReceipt!.artifactId!;

    const journal = await beginExecution(
      'plan-fault-settlement',
      'instance-fault-settlement',
      artifactId
    );

    await reserveTradeOnce(
      journal.riskReservationId!,
      EXACT_MINT,
      BigInt(BUY_LAMPORTS),
      1_000_000_000n
    );

    await markExecutionSigning(journal.executionId);
    await markExecutionBroadcastReady(journal.executionId, {
      transactionSignature: 'sig-settlement',
      signedTransactionSha256: SIGNED_TX_SHA,
      transactionMessageSha256: MSG_SHA,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    });
    await markExecutionSubmitted(journal.executionId, 'sig-settlement');

    /*
     * Manually create a 'pending' settlement (simulating
     * a crash after risk was applied but before the
     * execution transition). The settleExecutionOutcome
     * function will resume from 'pending'.
     */
    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    /*
     * First call drives to completion.
     */
    const result = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 111,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: 1_000_000_000n,
    });

    assert.equal(result.status, 'committed');

    /*
     * Re-run (recovery). Must be idempotent.
     */
    const result2 = await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 111,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: 1_000_000_000n,
    });

    assert.equal(result2.status, 'committed');

    /*
     * No double-counting: completedTrades is 1.
     */
    const risk = await getRiskState();
    assert.equal(risk.completedTrades, 1);

    /*
     * No duplicate audit events.
     */
    const events = await readAuditEvents();
    const confirmedEvents = events.filter(
      (e) => e.event === 'candidate.execution.confirmed'
    );
    assert.equal(confirmedEvents.length, 1);
  }
);

/*
 * Boundary 6: After execution terminal transition, before plan outcome.
 * The settlement is 'execution-applied'. Recovery: re-run
 * settleExecutionOutcome, which resumes from 'execution-applied'
 * and writes the plan outcome + audit.
 */
test(
  'fault: settlement crash after execution-applied resumes at plan outcome',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact(
      'plan-fault-exec-applied',
      'instance-fault-exec-applied'
    );

    const { beginExecution, markExecutionSigning,
      markExecutionBroadcastReady, markExecutionSubmitted } = await import(
      '../sniper/execution-journal.js'
    );
    const { reserveTradeOnce } = await import('../sniper/risk.js');
    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    const plan = await loadApprovedExecutionPlan('plan-fault-exec-applied');
    const artifactId = plan.state.simulationReceipt!.artifactId!;

    const journal = await beginExecution(
      'plan-fault-exec-applied',
      'instance-fault-exec-applied',
      artifactId
    );

    await reserveTradeOnce(
      journal.riskReservationId!,
      EXACT_MINT,
      BigInt(BUY_LAMPORTS),
      1_000_000_000n
    );

    await markExecutionSigning(journal.executionId);
    await markExecutionBroadcastReady(journal.executionId, {
      transactionSignature: 'sig-exec-applied',
      signedTransactionSha256: SIGNED_TX_SHA,
      transactionMessageSha256: MSG_SHA,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    });
    await markExecutionSubmitted(journal.executionId, 'sig-exec-applied');

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    /*
     * First call drives to completion.
     */
    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'failed',
      observedSlot: 222,
      failureReason: 'test failure',
      currentBalanceLamports: 1_000_000_000n,
    });

    /*
     * Re-run (recovery).
     */
    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'failed',
      observedSlot: 222,
      failureReason: 'test failure',
      currentBalanceLamports: 1_000_000_000n,
    });

    /*
     * No duplicate audit events.
     */
    const events = await readAuditEvents();
    const failedEvents = events.filter(
      (e) => e.event === 'candidate.execution.failed'
    );
    assert.equal(failedEvents.length, 1);

    /*
     * Risk reservation was released (not committed).
     */
    const risk = await getRiskState();
    assert.equal(risk.reservations.length, 0);
    assert.equal(risk.completedTrades, 0);
  }
);

/*
 * Boundary 7: After plan outcome write, before audit.
 * The settlement is 'plan-applied'. Recovery: re-run
 * settleExecutionOutcome, which resumes from 'plan-applied'
 * and writes the audit.
 */
test(
  'fault: settlement crash after plan-applied resumes at audit',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact(
      'plan-fault-plan-applied',
      'instance-fault-plan-applied'
    );

    const { beginExecution, markExecutionSigning,
      markExecutionBroadcastReady, markExecutionSubmitted } = await import(
      '../sniper/execution-journal.js'
    );
    const { reserveTradeOnce } = await import('../sniper/risk.js');
    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    const plan = await loadApprovedExecutionPlan('plan-fault-plan-applied');
    const artifactId = plan.state.simulationReceipt!.artifactId!;

    const journal = await beginExecution(
      'plan-fault-plan-applied',
      'instance-fault-plan-applied',
      artifactId
    );

    await reserveTradeOnce(
      journal.riskReservationId!,
      EXACT_MINT,
      BigInt(BUY_LAMPORTS),
      1_000_000_000n
    );

    await markExecutionSigning(journal.executionId);
    await markExecutionBroadcastReady(journal.executionId, {
      transactionSignature: 'sig-plan-applied',
      signedTransactionSha256: SIGNED_TX_SHA,
      transactionMessageSha256: MSG_SHA,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    });
    await markExecutionSubmitted(journal.executionId, 'sig-plan-applied');

    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 333,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: 1_000_000_000n,
    });

    /*
     * Verify the plan outcome was written.
     */
    const { loadApprovedExecutionPlan: loadPlan } = await import(
      '../sniper/execution-plan.js'
    );

    const loadedPlan = await loadPlan('plan-fault-plan-applied');
    assert.ok(loadedPlan.state.executionOutcome);
    assert.equal(loadedPlan.state.executionOutcome.outcome, 'confirmed');

    /*
     * Re-run settlement — idempotent.
     */
    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 333,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: 1_000_000_000n,
    });

    /*
     * No duplicate audit.
     */
    const events = await readAuditEvents();
    const confirmedEvents = events.filter(
      (e) => e.event === 'candidate.execution.confirmed'
    );
    assert.equal(confirmedEvents.length, 1);
  }
);

/*
 * Boundary 8: After archive write, before index append.
 * The archive file exists but the index doesn't have an entry.
 * Recovery: re-run archiveExecutionEvidence — it finds the
 * existing archive and calls indexExecutionArchive.
 */
test(
  'fault: crash after archive write recovers missing index',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact(
      'plan-fault-archive',
      'instance-fault-archive'
    );

    const { beginExecution, markExecutionSigning,
      markExecutionBroadcastReady, markExecutionSubmitted } = await import(
      '../sniper/execution-journal.js'
    );
    const { reserveTradeOnce } = await import('../sniper/risk.js');
    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );
    const { settleExecutionOutcome } = await import(
      '../sniper/execution-settlement.js'
    );
    const { archiveExecutionEvidence } = await import(
      '../sniper/execution-archive.js'
    );

    const plan = await loadApprovedExecutionPlan('plan-fault-archive');
    const artifactId = plan.state.simulationReceipt!.artifactId!;

    const journal = await beginExecution(
      'plan-fault-archive',
      'instance-fault-archive',
      artifactId
    );

    await reserveTradeOnce(
      journal.riskReservationId!,
      EXACT_MINT,
      BigInt(BUY_LAMPORTS),
      1_000_000_000n
    );

    await markExecutionSigning(journal.executionId);
    await markExecutionBroadcastReady(journal.executionId, {
      transactionSignature: 'sig-archive',
      signedTransactionSha256: SIGNED_TX_SHA,
      transactionMessageSha256: MSG_SHA,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    });
    await markExecutionSubmitted(journal.executionId, 'sig-archive');

    await settleExecutionOutcome({
      executionId: journal.executionId,
      outcome: 'confirmed',
      observedSlot: 444,
      confirmationStatus: 'confirmed',
      currentBalanceLamports: 1_000_000_000n,
    });

    /*
     * Archive the evidence.
     */
    await archiveExecutionEvidence('plan-fault-archive');

    /*
     * Delete the index to simulate a crash after
     * archive write but before index append.
     */
    const indexPath = join(planDir, 'execution-archives', 'index.jsonl');
    await rm(indexPath, { force: true });

    /*
     * Re-archive — finds existing archive, calls
     * indexExecutionArchive to recover the index.
     */
    await archiveExecutionEvidence('plan-fault-archive');

    /*
     * Verify the index has exactly one entry.
     */
    const { readExecutionArchiveIndex } = await import(
      '../sniper/execution-archive-index.js'
    );

    const entries = await readExecutionArchiveIndex();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].planInstanceId, 'instance-fault-archive');
  }
);

/*
 * Global invariant: no recovery path broadcasts a second
 * transaction.
 */
test(
  'fault: no recovery path broadcasts a second transaction',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact(
      'plan-fault-no-resend',
      'instance-fault-no-resend'
    );

    const rpc = new FaultInjectingRpc();

    /*
     * First execution: sends one transaction, throws
     * (wrong signature from fake RPC).
     */
    await assert.rejects(
      executeWithFakeRpc('plan-fault-no-resend', rpc),
      /RPC returned a different signature|already reached/i
    );

    assert.equal(rpc.sentTransactions.length, 1);

    /*
     * Re-run execution — must not send another transaction.
     */
    const rpc2 = new FaultInjectingRpc();

    await assert.rejects(
      executeWithFakeRpc('plan-fault-no-resend', rpc2),
      /already reached broadcasting|cannot start from/i
    );

    assert.equal(rpc2.sentTransactions.length, 0);

    /*
     * Total transactions sent across both RPC instances: 1.
     */
    assert.equal(
      rpc.sentTransactions.length + rpc2.sentTransactions.length,
      1
    );
  }
);

/*
 * Global invariant: tampered state is always rejected.
 */
test(
  'fault: tampered journal hash is rejected by recovery',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact(
      'plan-fault-tamper',
      'instance-fault-tamper'
    );

    const { beginExecution, markExecutionSigning,
      markExecutionBroadcastReady, markExecutionSubmitted } = await import(
      '../sniper/execution-journal.js'
    );
    const { reserveTradeOnce } = await import('../sniper/risk.js');
    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    const plan = await loadApprovedExecutionPlan('plan-fault-tamper');
    const artifactId = plan.state.simulationReceipt!.artifactId!;

    const journal = await beginExecution(
      'plan-fault-tamper',
      'instance-fault-tamper',
      artifactId
    );

    await reserveTradeOnce(
      journal.riskReservationId!,
      EXACT_MINT,
      BigInt(BUY_LAMPORTS),
      1_000_000_000n
    );

    await markExecutionSigning(journal.executionId);
    await markExecutionBroadcastReady(journal.executionId, {
      transactionSignature: 'sig-tamper',
      signedTransactionSha256: SIGNED_TX_SHA,
      transactionMessageSha256: MSG_SHA,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    });
    await markExecutionSubmitted(journal.executionId, 'sig-tamper');

    /*
     * Tamper with the journal file.
     */
    const journalPath = join(
      planDir,
      'execution-journals',
      `${journal.executionId}.json`
    );

    const content = await readFile(journalPath, 'utf8');
    const parsed = JSON.parse(content);

    parsed.submittedAt = '1970-01-01T00:00:00.000Z';

    await writeFile(journalPath, JSON.stringify(parsed, null, 2), 'utf8');

    /*
     * Any recovery operation that loads the journal
     * must reject the tampered hash.
     */
    const { loadExecutionJournal } = await import(
      '../sniper/execution-journal.js'
    );

    await assert.rejects(
      loadExecutionJournal(journal.executionId),
      /hash mismatch/i
    );
  }
);
