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

let configured = false;
let planDir: string;
let riskFile: string;
let auditFile: string;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(
      tmpdir(),
      'sniper-risk-reconcile-'
    )
  );

  planDir = join(dir, 'plans');
  riskFile = join(dir, 'risk.json');
  auditFile = join(dir, 'audit.jsonl');

  process.env.LIVE_TRADING =
    'false';
  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';
  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_DIR =
    planDir;
  process.env.RISK_FILE = riskFile;
  process.env.AUDIT_FILE = auditFile;
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS =
    '30';
  process.env.MAX_DAILY_SPEND_SOL = '0.2';
  process.env.MAX_DAILY_TRADES = '3';
  process.env.MAX_DAILY_DRAWDOWN_SOL = '0.1';

  configured = true;
}

async function cleanAll() {
  await configureEnvironment();

  await rm(planDir, {
    force: true,
    recursive: true,
  });

  await mkdir(planDir, {
    recursive: true,
    mode: 0o700,
  });

  await rm(riskFile, { force: true });
  await rm(auditFile, { force: true });
}

const PLAN_ID = 'test-plan-id';
const PLAN_INSTANCE_ID = 'test-instance-id';
const ARTIFACT_ID = 'test-artifact-id';
const SIGNED_TX_SHA = 'a'.repeat(64);
const MSG_SHA = 'b'.repeat(64);
const LAST_VALID_BLOCK_HEIGHT = 200_000_000;
const FAKE_WALLET_BALANCE = 1_000_000_000n;
const WALLET_PUBLIC_KEY =
  '11111111111111111111111111111111';
const EXACT_MINT = 'TEST_MINT_A';
const BUY_LAMPORTS = '50000000';

async function writePlan() {
  const { createHash } =
    await import('node:crypto');

  const { getApprovedExecutionPlanPath } =
    await import(
      '../sniper/execution-plan.js'
    );

  const state = {
    status: 'simulated' as const,
    simulationCount: 1,
    createdAt:
      new Date(
        Date.now() - 1_000
      ).toISOString(),
    simulatedAt:
      new Date().toISOString(),
    simulationReceipt: {
      transactionMessageSha256: MSG_SHA,
      serializedTransactionSha256:
        'c'.repeat(64),
      recentBlockhash:
        '11111111111111111111111111111111',
      lastValidBlockHeight:
        LAST_VALID_BLOCK_HEIGHT,
      simulatedAt:
        new Date().toISOString(),
      rpcEndpoint:
        'https://api.mainnet-beta.solana.com',
      contextSlot: 1,
      err: null,
      logsSha256: 'd'.repeat(64),
      walletPublicKey: WALLET_PUBLIC_KEY,
      expectedCluster: 'mainnet-beta',
      planSha256BeforeSimulation:
        'e'.repeat(64),
      transactionPolicyOk: true,
      transactionPolicySha256:
        'f'.repeat(64),
      artifactId: ARTIFACT_ID,
      artifactSha256: '1'.repeat(64),
    },
  };

  const payload = {
    signature: 'sig-reconcile-1',
    exactMint: EXACT_MINT,
    createdAt:
      new Date(1_000_000).toISOString(),
    quoteReceivedAtMs: 995_000,
    walletPublicKey: WALLET_PUBLIC_KEY,
    expectedCluster: 'mainnet-beta',
    buyLamports: BUY_LAMPORTS,
    approvedPoolAddress: 'POOL_1',
    approvedQuoteMint:
      'So11111111111111111111111111111111111111112',
    approvedLiquiditySol: 100,
    currentPoolAddress: 'POOL_1',
    currentQuoteMint:
      'So11111111111111111111111111111111111111112',
    currentLiquiditySol: 90,
    routeHopCount: 1,
    routeLabels: ['Raydium AMM'],
    routeAmmKeys: ['POOL_1'],
    quoteInputMint:
      'So11111111111111111111111111111111111111112',
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

  const stableStringify = (
    value: unknown
  ): string => {
    if (
      value === null ||
      typeof value !== 'object'
    ) {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return `[${value
        .map(stableStringify)
        .join(',')}]`;
    }

    const entries = Object.entries(
      value as Record<string, unknown>
    )
      .filter(
        ([, v]) => v !== undefined
      )
      .sort(([a], [b]) =>
        a.localeCompare(b)
      );

    return `{${entries
      .map(
        ([k, v]) =>
          `${JSON.stringify(k)}:${stableStringify(v)}`
      )
      .join(',')}}`;
  };

  const hash = createHash('sha256')
    .update(
      stableStringify({
        version: 3,
        planId: PLAN_ID,
        planInstanceId: PLAN_INSTANCE_ID,
        state,
        payload,
      })
    )
    .digest('hex');

  const path =
    getApprovedExecutionPlanPath(
      PLAN_ID
    );

  await mkdir(
    join(path, '..'),
    {
      recursive: true,
      mode: 0o700,
    }
  );

  await writeFile(
    path,
    JSON.stringify(
      {
        version: 3,
        planId: PLAN_ID,
        planInstanceId: PLAN_INSTANCE_ID,
        state,
        payload,
        sha256: hash,
      },
      null,
      2
    ),
    'utf8'
  );
}

async function createSubmittedJournalWithReservation() {
  const {
    beginExecution,
    markExecutionSigning,
    markExecutionBroadcastReady,
    markExecutionSubmitted,
  } = await import(
    '../sniper/execution-journal.js'
  );

  const {
    reserveTradeOnce,
  } = await import(
    '../sniper/risk.js'
  );

  await writePlan();

  const journal =
    await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

  await reserveTradeOnce(
    journal.riskReservationId!,
    EXACT_MINT,
    BigInt(BUY_LAMPORTS),
    FAKE_WALLET_BALANCE
  );

  await markExecutionSigning(
    journal.executionId
  );

  await markExecutionBroadcastReady(
    journal.executionId,
    {
      transactionSignature:
        'test-signature-123',
      signedTransactionSha256:
        SIGNED_TX_SHA,
      transactionMessageSha256:
        MSG_SHA,
      lastValidBlockHeight:
        LAST_VALID_BLOCK_HEIGHT,
    }
  );

  await markExecutionSubmitted(
    journal.executionId,
    'test-signature-123'
  );

  return journal;
}

function createFakeRpc(
  status:
    | {
        slot?: number;
        confirmationStatus:
          | 'processed'
          | 'confirmed'
          | 'finalized'
          | null;
        err: unknown | null;
      }
    | null
) {
  return {
    async getSignatureStatus() {
      if (status === null) {
        return null;
      }

      return {
        slot: status.slot ?? 100,
        confirmationStatus:
          status.confirmationStatus,
        err: status.err,
      };
    },

    async getWalletBalance() {
      return FAKE_WALLET_BALANCE;
    },
  };
}

test(
  'confirmation commits reservation once',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal =
      await createSubmittedJournalWithReservation();

    const { reconcileExecution } =
      await import(
        '../sniper/execution-reconciler.js'
      );

    const { getRiskState } =
      await import(
        '../sniper/risk.js'
      );

    await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        slot: 111_111,
        confirmationStatus:
          'confirmed',
        err: null,
      })
    );

    const state =
      await getRiskState(
        FAKE_WALLET_BALANCE
      );

    assert.equal(
      state.reservations.length,
      0
    );

    assert.ok(
      state.committedReservationIds.includes(
        journal.riskReservationId!
      )
    );

    /*
     * Reconcile again — the reservation is already
     * committed and the journal is already confirmed.
     * The early-return at the top of reconcileExecution
     * handles idempotency.
     */
    const second =
      await reconcileExecution(
        journal.executionId,
        createFakeRpc({
          slot: 111_111,
          confirmationStatus:
            'confirmed',
          err: null,
        })
      );

    assert.equal(
      second.action,
      'none'
    );

    const stateAfter =
      await getRiskState(
        FAKE_WALLET_BALANCE
      );

    assert.equal(
      stateAfter.reservations.length,
      0
    );

    assert.equal(
      stateAfter.committedReservationIds
        .length,
      1
    );
  }
);

test(
  'confirmation increments completed trades once',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal =
      await createSubmittedJournalWithReservation();

    const { reconcileExecution } =
      await import(
        '../sniper/execution-reconciler.js'
      );

    const { getRiskState } =
      await import(
        '../sniper/risk.js'
      );

    await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus:
          'confirmed',
        err: null,
      })
    );

    const state =
      await getRiskState(
        FAKE_WALLET_BALANCE
      );

    assert.equal(
      state.completedTrades,
      1
    );

    assert.ok(
      state.completedTradeIds.includes(
        journal.executionId
      )
    );
  }
);

test(
  'on-chain failure releases reservation',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal =
      await createSubmittedJournalWithReservation();

    const { reconcileExecution } =
      await import(
        '../sniper/execution-reconciler.js'
      );

    const { getRiskState } =
      await import(
        '../sniper/risk.js'
      );

    const result =
      await reconcileExecution(
        journal.executionId,
        createFakeRpc({
          slot: 222_222,
          confirmationStatus: null,
          err: {
            InstructionError:
              [0, 'Custom'],
          },
        })
      );

    assert.equal(
      result.action,
      'failed'
    );

    const state =
      await getRiskState(
        FAKE_WALLET_BALANCE
      );

    assert.equal(
      state.reservations.length,
      0
    );

    assert.ok(
      !state.committedReservationIds.includes(
        journal.riskReservationId!
      )
    );
  }
);

test(
  'repeated failure does not fail when already released',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal =
      await createSubmittedJournalWithReservation();

    const { reconcileExecution } =
      await import(
        '../sniper/execution-reconciler.js'
      );

    /*
     * First reconciliation: failure releases the
     * reservation and marks the journal failed.
     */
    await reconcileExecution(
      journal.executionId,
      createFakeRpc({
        confirmationStatus: null,
        err: {
          InstructionError:
            [0, 'Custom'],
        },
      })
    );

    /*
     * Second reconciliation: the journal is already
     * 'failed', so the top-of-function early-return
     * fires with action 'none'. No risk operations
     * are attempted.
     */
    const second =
      await reconcileExecution(
        journal.executionId,
        createFakeRpc({
          confirmationStatus: null,
          err: {
            InstructionError:
              [0, 'Custom'],
          },
        })
      );

    assert.equal(
      second.action,
      'none'
    );
    assert.equal(
      second.journal.status,
      'failed'
    );
  }
);

test(
  'RPC balance failure leaves journal nonterminal',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const journal =
      await createSubmittedJournalWithReservation();

    const { reconcileExecution } =
      await import(
        '../sniper/execution-reconciler.js'
      );

    const { loadExecutionJournal } =
      await import(
        '../sniper/execution-journal.js'
      );

    /*
     * The RPC returns a confirmed status but throws
     * when getWalletBalance is called. The reconciler
     * must propagate the error and leave the journal
     * in its nonterminal 'submitted' state.
     */
    const rpc = {
      async getSignatureStatus() {
        return {
          slot: 111,
          confirmationStatus:
            'confirmed' as const,
          err: null,
        };
      },

      async getWalletBalance() {
        throw new Error(
          'RPC balance unavailable'
        );
      },
    };

    await assert.rejects(
      reconcileExecution(
        journal.executionId,
        rpc
      ),
      /RPC balance unavailable/i
    );

    const reloaded =
      await loadExecutionJournal(
        journal.executionId
      );

    assert.ok(reloaded);
    assert.equal(
      reloaded.status,
      'submitted'
    );
  }
);

test(
  'risk commit failure leaves journal submitted',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Create a journal with a reservation, then
     * manually commit the reservation so that
     * commitReservation is called again on an
     * already-committed ID. commitReservation is
     * idempotent (returns void), so this won't
     * throw. Instead, test that a missing
     * reservation (deleted between status check
     * and commit) causes the reconciler to throw
     * and leave the journal nonterminal.
     */
    const journal =
      await createSubmittedJournalWithReservation();

    const { reconcileExecution } =
      await import(
        '../sniper/execution-reconciler.js'
      );

    const { loadExecutionJournal } =
      await import(
        '../sniper/execution-journal.js'
      );

    const {
      releaseReservationIfPresent,
    } = await import(
      '../sniper/risk.js'
    );

    /*
     * Remove the reservation behind the reconciler's
     * back. Now commitReservation will throw
     * "was not found".
     */
    await releaseReservationIfPresent(
      journal.riskReservationId!,
      EXACT_MINT,
      FAKE_WALLET_BALANCE
    );

    await assert.rejects(
      reconcileExecution(
        journal.executionId,
        createFakeRpc({
          confirmationStatus:
            'confirmed',
          err: null,
        })
      ),
      /was not found/i
    );

    const reloaded =
      await loadExecutionJournal(
        journal.executionId
      );

    assert.ok(reloaded);
    assert.equal(
      reloaded.status,
      'submitted'
    );
  }
);
