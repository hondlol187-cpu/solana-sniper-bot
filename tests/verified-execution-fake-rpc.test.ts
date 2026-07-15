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
let keyFilePath: string;

const SIGNED_TX_SHA = 'a'.repeat(64);
const MSG_SHA = 'b'.repeat(64);
const LAST_VALID_BLOCK_HEIGHT = 200_000_000;
const WALLET_PUBLIC_KEY = '11111111111111111111111111111111';
const EXACT_MINT = 'TEST_MINT_A';
const BUY_LAMPORTS = '50000000';

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-fake-rpc-')
  );

  planDir = join(dir, 'plans');
  riskFile = join(dir, 'risk.json');
  auditFile = join(dir, 'audit.jsonl');

  /*
   * Create a key file so config.ts loads successfully
   * with LIVE_TRADING=true. The actual keypair used in
   * tests is generated per-test; this just satisfies
   * the key-loader.
   */
  const keypair = Keypair.generate();
  keyFilePath = join(dir, 'key.json');

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

class FakeVerifiedExecutionRpc
implements VerifiedExecutionRpc {
  balance = 1_000_000_000n;
  blockhashValid = true;
  blockHeight = 100;
  sentTransactions: Buffer[] = [];
  returnedSignature = 'expected-signature';

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
    this.sentTransactions.push(
      Buffer.from(bytes)
    );
    return this.returnedSignature;
  }
}

function buildTransaction(wallet: PublicKey): Buffer {
  const dummyProgram = new PublicKey(
    '11111111111111111111111111111112'
  );

  const data = Buffer.alloc(4);
  data.writeUInt32LE(Date.now() & 0xffffffff, 0);

  const message = MessageV0.compile({
    payerKey: wallet,
    instructions: [
      new TransactionInstruction({
        keys: [
          { pubkey: wallet, isSigner: true, isWritable: true },
        ],
        programId: dummyProgram,
        data,
      }),
    ],
    recentBlockhash: '11111111111111111111111111111111',
    addressLookupTableAccounts: [],
  });

  const tx = new VersionedTransaction(message);
  return Buffer.from(tx.serialize());
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
  const serializedTx = buildTransaction(signer.publicKey);
  const serializedTxSha = createHash('sha256')
    .update(serializedTx)
    .digest('hex');

  const storedArtifact = await persistSimulationArtifact({
    planId,
    planInstanceId,
    planSha256BeforeSimulation: 'e'.repeat(64),
    serializedTransaction: serializedTx,
    simulationResponse: { contextSlot: 1, err: null, logs: [] },
    createdAt: new Date().toISOString(),
  });

  /*
   * Compute the transaction message hash from the
   * deserialized transaction.
   */
  const deserialized = VersionedTransaction.deserialize(serializedTx);
  const messageSha = createHash('sha256')
    .update(deserialized.message.serialize())
    .digest('hex');

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

  return { storedArtifact, serializedTxSha };
}

async function executeWithFakeRpc(
  planId: string,
  rpc: FakeVerifiedExecutionRpc
) {
  const { config } = await import('../sniper/config.js');
  const { executeVerifiedPlan } = await import(
    '../sniper/verified-execution-core.js'
  );

  return executeVerifiedPlan(planId, config.keypair!, rpc);
}

test(
  'successful full execution submits one exact transaction',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await setupPlanAndArtifact('plan-fake-success', 'instance-fake-success');

    /*
     * The fake RPC returns 'expected-signature' but the
     * deterministic signature from signing will be
     * different. So the execution will throw "RPC returned
     * a different signature" AFTER broadcasting. The
     * journal is left in 'broadcasting' and exactly one
     * transaction is sent.
     */
    const rpc = new FakeVerifiedExecutionRpc();

    await assert.rejects(
      executeWithFakeRpc('plan-fake-success', rpc),
      /RPC returned a different signature|already reached/i
    );

    assert.equal(rpc.sentTransactions.length, 1);
  }
);

test(
  'invalid blockhash submits zero',
  async () => {
    await configureEnvironment();
    await cleanAll();


    await setupPlanAndArtifact('plan-fake-blockhash', 'instance-fake-blockhash');

    const rpc = new FakeVerifiedExecutionRpc();
    rpc.blockhashValid = false;

    await assert.rejects(
      executeWithFakeRpc('plan-fake-blockhash', rpc),
      /blockhash is no longer valid/i
    );

    assert.equal(rpc.sentTransactions.length, 0);
  }
);

test(
  'expired block height submits zero',
  async () => {
    await configureEnvironment();
    await cleanAll();


    await setupPlanAndArtifact('plan-fake-expired', 'instance-fake-expired');

    const rpc = new FakeVerifiedExecutionRpc();
    rpc.blockHeight = LAST_VALID_BLOCK_HEIGHT + 1;

    await assert.rejects(
      executeWithFakeRpc('plan-fake-expired', rpc),
      /expired/i
    );

    assert.equal(rpc.sentTransactions.length, 0);
  }
);

test(
  'insufficient balance submits zero',
  async () => {
    await configureEnvironment();
    await cleanAll();


    await setupPlanAndArtifact('plan-fake-balance', 'instance-fake-balance');

    const rpc = new FakeVerifiedExecutionRpc();
    rpc.balance = 0n;

    await assert.rejects(
      executeWithFakeRpc('plan-fake-balance', rpc),
      /insufficient/i
    );

    assert.equal(rpc.sentTransactions.length, 0);
  }
);

test(
  'risk rejection submits zero',
  async () => {
    await configureEnvironment();
    await cleanAll();


    await setupPlanAndArtifact('plan-fake-risk', 'instance-fake-risk');

    /*
     * Pre-reserve enough to exceed the daily spend limit.
     */
    const { reserveTradeOnce } = await import('../sniper/risk.js');

    await reserveTradeOnce(
      'pre-reserve-1',
      EXACT_MINT,
      200_000_000n,
      1_000_000_000n
    );

    const rpc = new FakeVerifiedExecutionRpc();

    await assert.rejects(
      executeWithFakeRpc('plan-fake-risk', rpc),
      /Daily spend limit exceeded|halted/i
    );

    assert.equal(rpc.sentTransactions.length, 0);
  }
);

test(
  'wrong returned signature leaves broadcasting',
  async () => {
    await configureEnvironment();
    await cleanAll();


    await setupPlanAndArtifact('plan-fake-wrong-sig', 'instance-fake-wrong-sig');

    const rpc = new FakeVerifiedExecutionRpc();
    rpc.returnedSignature = 'wrong-signature';

    await assert.rejects(
      executeWithFakeRpc('plan-fake-wrong-sig', rpc),
      /RPC returned a different signature|already reached/i
    );

    assert.equal(rpc.sentTransactions.length, 1);

    /*
     * The journal should be in 'broadcasting' because
     * the send succeeded but the signature mismatch
     * threw after broadcastPrepared was set.
     */
    const { listExecutionJournals } = await import(
      '../sniper/execution-journal.js'
    );

    const journals = await listExecutionJournals();
    const journal = journals.find(
      (j) => j.planId === 'plan-fake-wrong-sig'
    );

    assert.ok(journal);
    assert.equal(journal.status, 'broadcasting');
  }
);

test(
  'send exception leaves broadcasting',
  async () => {
    await configureEnvironment();
    await cleanAll();


    await setupPlanAndArtifact('plan-fake-send-ex', 'instance-fake-send-ex');

    const rpc = new FakeVerifiedExecutionRpc();

    rpc.sendExactTransaction = async () => {
      throw new Error('RPC send failed');
    };

    await assert.rejects(
      executeWithFakeRpc('plan-fake-send-ex', rpc),
      /RPC send failed|already reached/i
    );

    const { listExecutionJournals } = await import(
      '../sniper/execution-journal.js'
    );

    const journals = await listExecutionJournals();
    const journal = journals.find(
      (j) => j.planId === 'plan-fake-send-ex'
    );

    assert.ok(journal);
    assert.equal(journal.status, 'broadcasting');
  }
);

test(
  'repeated execution submits zero additional transactions',
  async () => {
    await configureEnvironment();
    await cleanAll();


    await setupPlanAndArtifact('plan-fake-repeat', 'instance-fake-repeat');

    const rpc = new FakeVerifiedExecutionRpc();

    /*
     * First execution: throws (wrong signature) but
     * sends one transaction and leaves journal in
     * 'broadcasting'.
     */
    await assert.rejects(
      executeWithFakeRpc('plan-fake-repeat', rpc),
      /RPC returned a different signature|already reached/i
    );

    assert.equal(rpc.sentTransactions.length, 1);

    /*
     * Second execution: the journal is already in
     * 'broadcasting', so beginExecution throws
     * "already reached broadcasting". No additional
     * transaction is sent.
     */
    await assert.rejects(
      executeWithFakeRpc('plan-fake-repeat', rpc),
      /already reached broadcasting|cannot start from/i
    );

    assert.equal(rpc.sentTransactions.length, 1);
  }
);

test(
  'submitted journal cannot resend',
  async () => {
    await configureEnvironment();
    await cleanAll();


    await setupPlanAndArtifact('plan-fake-submitted', 'instance-fake-submitted');

    /*
     * Manually create a journal in 'submitted' state.
     */
    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
      markExecutionSubmitted,
    } = await import('../sniper/execution-journal.js');

    const { reserveTradeOnce } = await import('../sniper/risk.js');

    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    const plan = await loadApprovedExecutionPlan('plan-fake-submitted');
    const artifactId = plan.state.simulationReceipt!.artifactId!;

    const journal = await beginExecution(
      'plan-fake-submitted',
      'instance-fake-submitted',
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
      transactionSignature: 'sig-submitted',
      signedTransactionSha256: SIGNED_TX_SHA,
      transactionMessageSha256: MSG_SHA,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    });
    await markExecutionSubmitted(journal.executionId, 'sig-submitted');

    const rpc = new FakeVerifiedExecutionRpc();

    await assert.rejects(
      executeWithFakeRpc('plan-fake-submitted', rpc),
      /already reached submitted|cannot start from/i
    );

    assert.equal(rpc.sentTransactions.length, 0);
  }
);

test(
  'confirmed journal cannot resend',
  async () => {
    await configureEnvironment();
    await cleanAll();


    await setupPlanAndArtifact('plan-fake-confirmed', 'instance-fake-confirmed');

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
      markExecutionSubmitted,
      markExecutionConfirmed,
    } = await import('../sniper/execution-journal.js');

    const { reserveTradeOnce } = await import('../sniper/risk.js');

    const { loadApprovedExecutionPlan } = await import(
      '../sniper/execution-plan.js'
    );

    const plan = await loadApprovedExecutionPlan('plan-fake-confirmed');
    const artifactId = plan.state.simulationReceipt!.artifactId!;

    const journal = await beginExecution(
      'plan-fake-confirmed',
      'instance-fake-confirmed',
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
      transactionSignature: 'sig-confirmed',
      signedTransactionSha256: SIGNED_TX_SHA,
      transactionMessageSha256: MSG_SHA,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    });
    await markExecutionSubmitted(journal.executionId, 'sig-confirmed');
    await markExecutionConfirmed(journal.executionId, {
      slot: 100,
      confirmationStatus: 'confirmed',
    });

    const rpc = new FakeVerifiedExecutionRpc();

    await assert.rejects(
      executeWithFakeRpc('plan-fake-confirmed', rpc),
      /already reached confirmed|cannot start from/i
    );

    assert.equal(rpc.sentTransactions.length, 0);
  }
);

test(
  'fake RPC exposes no quote/build/retry method',
  async () => {
    const rpc = new FakeVerifiedExecutionRpc();

    const keys = Object.getOwnPropertyNames(
      Object.getPrototypeOf(rpc)
    );

    assert.ok(!keys.includes('getQuote'));
    assert.ok(!keys.includes('buildSwapTransaction'));
    assert.ok(!keys.includes('retry'));
    assert.ok(!keys.includes('simulateTransaction'));
    assert.ok(!keys.includes('confirmTransaction'));

    assert.ok(keys.includes('getWalletBalance'));
    assert.ok(keys.includes('isBlockhashValid'));
    assert.ok(keys.includes('getCurrentBlockHeight'));
    assert.ok(keys.includes('sendExactTransaction'));
  }
);
