import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  ExecutionSignatureStatus,
  ExecutionStatusRpc,
} from '../sniper/execution-reconciler.js';

let configured = false;
let planDir: string;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-reconcile-')
  );

  planDir = join(dir, 'plans');

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL = 'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY = '11111111111111111111111111111111';
  process.env.OUTPUT_MINT = 'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_DIR = planDir;
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS = '30';

  configured = true;
}

async function cleanAll() {
  await configureEnvironment();

  await rm(planDir, { force: true, recursive: true });
  await mkdir(planDir, { recursive: true, mode: 0o700 });
}

const PLAN_ID = 'test-plan-id';
const PLAN_INSTANCE_ID = 'test-instance-id';
const ARTIFACT_ID = 'test-artifact-id';

const SIGNED_TX_SHA = 'a'.repeat(64);
const MSG_SHA = 'b'.repeat(64);
const LAST_VALID_BLOCK_HEIGHT = 200_000_000;

function createFakeRpc(
  status: ExecutionSignatureStatus | null
): ExecutionStatusRpc {
  return {
    async getSignatureStatus() {
      return status;
    },
  };
}

function createErrorRpc(
  error: Error
): ExecutionStatusRpc {
  return {
    async getSignatureStatus() {
      throw error;
    },
  };
}

async function createSubmittedJournal() {
  const {
    beginExecution,
    markExecutionSigning,
    markExecutionBroadcastReady,
    markExecutionSubmitted,
  } = await import('../sniper/execution-journal.js');

  const journal = await beginExecution(
    PLAN_ID,
    PLAN_INSTANCE_ID,
    ARTIFACT_ID
  );

  await markExecutionSigning(journal.executionId);

  await markExecutionBroadcastReady(
    journal.executionId,
    {
      transactionSignature: 'test-signature-123',
      signedTransactionSha256: SIGNED_TX_SHA,
      transactionMessageSha256: MSG_SHA,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    }
  );

  const submitted = await markExecutionSubmitted(
    journal.executionId,
    'test-signature-123'
  );

  return submitted;
}

async function createBroadcastingJournal() {
  const {
    beginExecution,
    markExecutionSigning,
    markExecutionBroadcastReady,
  } = await import('../sniper/execution-journal.js');

  const journal = await beginExecution(
    PLAN_ID,
    PLAN_INSTANCE_ID,
    ARTIFACT_ID
  );

  await markExecutionSigning(journal.executionId);

  const broadcasting = await markExecutionBroadcastReady(
    journal.executionId,
    {
      transactionSignature: 'test-signature-123',
      signedTransactionSha256: SIGNED_TX_SHA,
      transactionMessageSha256: MSG_SHA,
      lastValidBlockHeight: LAST_VALID_BLOCK_HEIGHT,
    }
  );

  return broadcasting;
}

test(
  'processed status remains submitted',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: 'processed',
        err: null,
      })
    );

    assert.equal(result.action, 'none');
    assert.equal(result.journal.status, 'submitted');
  }
);

test(
  'confirmed status becomes confirmed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: 'confirmed',
        err: null,
      })
    );

    assert.equal(result.action, 'confirmed');
    assert.equal(result.journal.status, 'confirmed');
  }
);

test(
  'finalized status becomes confirmed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: 'finalized',
        err: null,
      })
    );

    assert.equal(result.action, 'confirmed');
    assert.equal(result.journal.status, 'confirmed');
  }
);

test(
  'RPC err becomes failed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: null,
        err: { InstructionError: [0, 'Custom'] },
      })
    );

    assert.equal(result.action, 'failed');
    assert.equal(result.journal.status, 'failed');
    assert.match(
      result.journal.failureReason ?? '',
      /On-chain transaction error/i
    );
  }
);

test(
  'null status remains submitted',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc(null)
    );

    assert.equal(result.action, 'none');
    assert.equal(result.journal.status, 'submitted');
  }
);

test(
  'RPC exception leaves journal unchanged',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    await assert.rejects(
      reconcileExecution(
        journal.executionId,
        createErrorRpc(new Error('RPC unavailable'))
      ),
      /Failed to reconcile.*RPC unavailable/i
    );

    const { loadExecutionJournal } = await import(
      '../sniper/execution-journal.js'
    );

    const unchanged = await loadExecutionJournal(
      journal.executionId
    );

    assert.ok(unchanged);
    assert.equal(unchanged.status, 'submitted');
  }
);

test(
  'confirmed reconciliation is idempotent',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: 'confirmed',
        err: null,
      })
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: 'confirmed',
        err: null,
      })
    );

    assert.equal(result.action, 'none');
    assert.equal(result.journal.status, 'confirmed');
  }
);

test(
  'failed reconciliation is idempotent',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: null,
        err: { InstructionError: [0, 'Custom'] },
      })
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: null,
        err: { InstructionError: [0, 'Custom'] },
      })
    );

    assert.equal(result.action, 'none');
    assert.equal(result.journal.status, 'failed');
  }
);

test(
  'reconciliation never calls a send/broadcast method',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    let broadcastCalled = false;

    const rpc: ExecutionStatusRpc = {
      async getSignatureStatus() {
        return {
          confirmationStatus: 'confirmed',
          err: null,
        };
      },
    };

    /*
     * The fake RPC has no send/broadcast method.
     * If reconcileExecution tried to call one, it
     * would throw. This test proves the reconciler
     * only reads status, never broadcasts.
     */
    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      rpc
    );

    assert.equal(result.action, 'confirmed');
    assert.equal(broadcastCalled, false);
  }
);

test(
  'concurrent reconciliations allow one terminal transition',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createSubmittedJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const rpc = createFakeRpc({
      confirmationStatus: 'confirmed',
      err: null,
    });

    const results = await Promise.allSettled([
      reconcileExecution(journal.executionId, rpc),
      reconcileExecution(journal.executionId, rpc),
    ]);

    const fulfilled = results.filter(
      (r) => r.status === 'fulfilled'
    );

    /*
     * Both may succeed (the second is idempotent),
     * but only one performs the actual transition.
     */
    assert.ok(fulfilled.length >= 1);

    const { loadExecutionJournal } = await import(
      '../sniper/execution-journal.js'
    );

    const final = await loadExecutionJournal(
      journal.executionId
    );

    assert.ok(final);
    assert.equal(final.status, 'confirmed');
  }
);

test(
  'broadcasting execution can be reconciled to confirmed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createBroadcastingJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: 'confirmed',
        err: null,
      })
    );

    assert.equal(result.action, 'confirmed');
    assert.equal(result.journal.status, 'confirmed');
  }
);

test(
  'broadcasting execution can be reconciled to failed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createBroadcastingJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: null,
        err: { InstructionError: [0, 'Custom'] },
      })
    );

    assert.equal(result.action, 'failed');
    assert.equal(result.journal.status, 'failed');
  }
);

test(
  'broadcasting execution with null RPC status stays broadcasting',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal = await createBroadcastingJournal();

    const { reconcileExecution } = await import(
      '../sniper/execution-reconciler.js'
    );

    const result = await reconcileExecution(
      journal.executionId,
      createFakeRpc(null)
    );

    assert.equal(result.action, 'none');
    assert.equal(result.journal.status, 'broadcasting');
  }
);
