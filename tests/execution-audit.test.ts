import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;
let planDir: string;
let auditFile: string;
let riskFile: string;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(
      tmpdir(),
      'sniper-execution-audit-'
    )
  );

  planDir = join(dir, 'plans');
  auditFile = join(dir, 'audit.jsonl');
  riskFile = join(dir, 'risk.json');

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
  process.env.AUDIT_FILE = auditFile;
  process.env.RISK_FILE = riskFile;
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

  await rm(auditFile, {
    force: true,
  });

  await rm(riskFile, {
    force: true,
  });
}

const SIGNED_TX_SHA = 'a'.repeat(64);
const MSG_SHA = 'b'.repeat(64);
const LAST_VALID_BLOCK_HEIGHT = 200_000_000;
const FAKE_WALLET_BALANCE = 1_000_000_000n;
const WALLET_PUBLIC_KEY =
  '11111111111111111111111111111111';
const EXACT_MINT = 'TEST_MINT_A';
const BUY_LAMPORTS = '50000000';

/*
 * Write a minimal v3 plan file that loadApprovedExecutionPlan
 * accepts. The reconciler reads plan.planInstanceId,
 * plan.payload.walletPublicKey, and plan.payload.exactMint.
 */
async function writePlan(
  planId: string,
  planInstanceId: string,
  artifactId: string
) {
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
      artifactId,
      artifactSha256: '1'.repeat(64),
    },
  };

  const payload = {
    signature: `sig-${planId}`,
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
        planId,
        planInstanceId,
        state,
        payload,
      })
    )
    .digest('hex');

  const path =
    getApprovedExecutionPlanPath(planId);

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
        planId,
        planInstanceId,
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

async function readAuditEvents(): Promise<
  Array<{
    event: string;
    details: Record<
      string,
      unknown
    >;
  }>
> {
  try {
    const content =
      await readFile(
        auditFile,
        'utf8'
      );

    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) =>
        JSON.parse(line) as {
          event: string;
          details: Record<
            string,
            unknown
          >;
        }
      );
  } catch {
    return [];
  }
}

test(
  'reconciler audits confirmed and failed transitions',
  async () => {
    await configureEnvironment();
    await cleanAll();

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

    /*
     * Build a submitted journal, then reconcile it to confirmed.
     */
    const journalA =
      await beginExecution(
        'plan-confirmed-audit',
        'instance-confirmed-audit',
        'artifact-confirmed-audit'
      );

    await writePlan(
      'plan-confirmed-audit',
      'instance-confirmed-audit',
      'artifact-confirmed-audit'
    );

    await reserveTradeOnce(
      journalA.riskReservationId!,
      EXACT_MINT,
      BigInt(BUY_LAMPORTS),
      FAKE_WALLET_BALANCE
    );

    await markExecutionSigning(
      journalA.executionId
    );

    await markExecutionBroadcastReady(
      journalA.executionId,
      {
        transactionSignature:
          'sig-confirmed-audit',
        signedTransactionSha256:
          SIGNED_TX_SHA,
        transactionMessageSha256:
          MSG_SHA,
        lastValidBlockHeight:
          LAST_VALID_BLOCK_HEIGHT,
      }
    );

    await markExecutionSubmitted(
      journalA.executionId,
      'sig-confirmed-audit'
    );

    const { reconcileExecution } =
      await import(
        '../sniper/execution-reconciler.js'
      );

    await reconcileExecution(
      journalA.executionId,
      {
        async getSignatureStatus() {
          return {
            slot: 111_111,
            confirmationStatus:
              'confirmed',
            err: null,
          };
        },

        async getWalletBalance() {
          return FAKE_WALLET_BALANCE;
        },
      }
    );

    /*
     * Build a second submitted journal, then reconcile it to failed.
     */
    const journalB =
      await beginExecution(
        'plan-failed-audit',
        'instance-failed-audit',
        'artifact-failed-audit'
      );

    await writePlan(
      'plan-failed-audit',
      'instance-failed-audit',
      'artifact-failed-audit'
    );

    await reserveTradeOnce(
      journalB.riskReservationId!,
      EXACT_MINT,
      BigInt(BUY_LAMPORTS),
      FAKE_WALLET_BALANCE
    );

    await markExecutionSigning(
      journalB.executionId
    );

    await markExecutionBroadcastReady(
      journalB.executionId,
      {
        transactionSignature:
          'sig-failed-audit',
        signedTransactionSha256:
          SIGNED_TX_SHA,
        transactionMessageSha256:
          MSG_SHA,
        lastValidBlockHeight:
          LAST_VALID_BLOCK_HEIGHT,
      }
    );

    await markExecutionSubmitted(
      journalB.executionId,
      'sig-failed-audit'
    );

    await reconcileExecution(
      journalB.executionId,
      {
        async getSignatureStatus() {
          return {
            slot: 222_222,
            confirmationStatus: null,
            err: {
              InstructionError:
                [0, 'Custom'],
            },
          };
        },

        async getWalletBalance() {
          return FAKE_WALLET_BALANCE;
        },
      }
    );

    const events =
      await readAuditEvents();

    const confirmedEvent =
      events.find(
        (e) =>
          e.event ===
          'candidate.execution.confirmed'
      );

    assert.ok(
      confirmedEvent,
      'confirmed audit event must be recorded'
    );

    assert.equal(
      confirmedEvent.details.executionId,
      journalA.executionId
    );

    assert.equal(
      confirmedEvent.details.confirmedSlot,
      111_111
    );

    assert.equal(
      confirmedEvent.details
        .confirmationStatus,
      'confirmed'
    );

    const failedEvent =
      events.find(
        (e) =>
          e.event ===
          'candidate.execution.failed'
      );

    assert.ok(
      failedEvent,
      'failed audit event must be recorded'
    );

    assert.equal(
      failedEvent.details.executionId,
      journalB.executionId
    );

    assert.equal(
      failedEvent.details.failedSlot,
      222_222
    );

    assert.match(
      String(
        failedEvent.details
          .failureReason
      ),
      /On-chain transaction error/i
    );
  }
);

test(
  'execution-audit helpers write the expected event names',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      auditExecutionReady,
      auditExecutionBroadcasting,
      auditExecutionSubmitted,
      auditExecutionConfirmed,
      auditExecutionFailed,
    } = await import(
      '../sniper/execution-audit.js'
    );

    /*
     * Build minimal journal-shaped objects. The audit
     * helpers only read fields, they do not validate.
     */
    const baseJournal = {
      version: 1 as const,
      executionId: 'exec-1',
      planId: 'plan-1',
      planInstanceId: 'instance-1',
      artifactId: 'artifact-1',
      status: 'ready' as const,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      transactionSignature:
        'sig-1',
      signedTransactionSha256:
        SIGNED_TX_SHA,
      transactionMessageSha256:
        MSG_SHA,
      lastValidBlockHeight:
        LAST_VALID_BLOCK_HEIGHT,
      broadcastPreparedAt:
        '2024-01-01T00:00:01.000Z',
      submittedAt:
        '2024-01-01T00:00:02.000Z',
      confirmedAt:
        '2024-01-01T00:00:03.000Z',
      confirmedSlot: 500,
      confirmationStatus:
        'confirmed' as const,
      failedAt:
        '2024-01-01T00:00:04.000Z',
      failedSlot: 600,
      failureReason: 'test failure',
      journalSha256:
        'c'.repeat(64),
    };

    await auditExecutionReady(
      baseJournal
    );

    await auditExecutionBroadcasting(
      {
        ...baseJournal,
        status: 'broadcasting',
      }
    );

    await auditExecutionSubmitted(
      {
        ...baseJournal,
        status: 'submitted',
      }
    );

    await auditExecutionConfirmed(
      {
        ...baseJournal,
        status: 'confirmed',
      }
    );

    await auditExecutionFailed(
      {
        ...baseJournal,
        status: 'failed',
      }
    );

    const events =
      await readAuditEvents();

    const names = events.map(
      (e) => e.event
    );

    assert.deepEqual(
      names,
      [
        'candidate.execution.ready',
        'candidate.execution.broadcasting',
        'candidate.execution.submitted',
        'candidate.execution.confirmed',
        'candidate.execution.failed',
      ]
    );

    /*
     * Verify the broadcasting event carries the
     * pre-broadcast evidence fields.
     */
    const broadcastingEvent =
      events.find(
        (e) =>
          e.event ===
          'candidate.execution.broadcasting'
      );

    assert.equal(
      broadcastingEvent?.details
        .signedTransactionSha256,
      SIGNED_TX_SHA
    );

    assert.equal(
      broadcastingEvent?.details
        .lastValidBlockHeight,
      LAST_VALID_BLOCK_HEIGHT
    );

    /*
     * Verify the confirmed event carries the slot
     * and confirmation status.
     */
    const confirmedEvent =
      events.find(
        (e) =>
          e.event ===
          'candidate.execution.confirmed'
      );

    assert.equal(
      confirmedEvent?.details
        .confirmedSlot,
      500
    );

    assert.equal(
      confirmedEvent?.details
        .confirmationStatus,
      'confirmed'
    );

    /*
     * Verify the failed event carries the slot
     * and failure reason.
     */
    const failedEvent = events.find(
      (e) =>
        e.event ===
        'candidate.execution.failed'
    );

    assert.equal(
      failedEvent?.details.failedSlot,
      600
    );

    assert.equal(
      failedEvent?.details
        .failureReason,
      'test failure'
    );
  }
);

test(
  'calling each helper twice creates one event',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      auditExecutionReady,
      auditExecutionBroadcasting,
      auditExecutionSubmitted,
      auditExecutionConfirmed,
      auditExecutionFailed,
    } = await import(
      '../sniper/execution-audit.js'
    );

    const baseJournal = {
      version: 1 as const,
      executionId: 'exec-once-1',
      planId: 'plan-1',
      planInstanceId: 'instance-1',
      artifactId: 'artifact-1',
      status: 'ready' as const,
      createdAt:
        '2024-01-01T00:00:00.000Z',
      updatedAt:
        '2024-01-01T00:00:00.000Z',
      riskReservationId:
        'a'.repeat(32),
      transactionSignature:
        'sig-1',
      signedTransactionSha256:
        SIGNED_TX_SHA,
      transactionMessageSha256:
        MSG_SHA,
      lastValidBlockHeight:
        LAST_VALID_BLOCK_HEIGHT,
      broadcastPreparedAt:
        '2024-01-01T00:00:01.000Z',
      submittedAt:
        '2024-01-01T00:00:02.000Z',
      confirmedAt:
        '2024-01-01T00:00:03.000Z',
      confirmedSlot: 500,
      confirmationStatus:
        'confirmed' as const,
      failedAt:
        '2024-01-01T00:00:04.000Z',
      failedSlot: 600,
      failureReason: 'test failure',
      journalSha256:
        'c'.repeat(64),
    };

    /*
     * Call each helper twice. The second call must
     * be a no-op (written: false) because the
     * auditEventId is deterministic and already
     * present.
     */
    const ready1 =
      await auditExecutionReady(
        baseJournal
      );
    const ready2 =
      await auditExecutionReady(
        baseJournal
      );

    assert.equal(
      ready1.written,
      true
    );
    assert.equal(
      ready2.written,
      false
    );

    /*
     * Different journal states get different event IDs,
     * so each transition audits exactly once.
     */
    const broadcasting1 =
      await auditExecutionBroadcasting(
        {
          ...baseJournal,
          status: 'broadcasting',
        }
      );

    assert.equal(
      broadcasting1.written,
      true
    );

    const events =
      await readAuditEvents();

    const readyEvents =
      events.filter(
        (e) =>
          e.event ===
          'candidate.execution.ready'
      );

    assert.equal(
      readyEvents.length,
      1
    );
  }
);

test(
  'concurrent calls create one event',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      auditExecutionReady,
    } = await import(
      '../sniper/execution-audit.js'
    );

    const journal = {
      version: 1 as const,
      executionId: 'exec-concurrent-1',
      planId: 'plan-1',
      planInstanceId: 'instance-1',
      artifactId: 'artifact-1',
      status: 'ready' as const,
      createdAt:
        '2024-01-01T00:00:00.000Z',
      updatedAt:
        '2024-01-01T00:00:00.000Z',
      riskReservationId:
        'a'.repeat(32),
      transactionSignature:
        'sig-1',
      journalSha256:
        'c'.repeat(64),
    };

    /*
     * Fire two concurrent calls with the same journal.
     * Exactly one must win; the other returns
     * written: false.
     */
    const [a, b] =
      await Promise.all([
        auditExecutionReady(
          journal
        ),
        auditExecutionReady(
          journal
        ),
      ]);

    const writtenCount = [a, b].filter(
      (r) => r.written
    ).length;

    assert.equal(
      writtenCount,
      1
    );

    const events =
      await readAuditEvents();

    assert.equal(
      events.length,
      1
    );
  }
);

test(
  'different journal states create different IDs',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      auditExecutionReady,
      auditExecutionSubmitted,
    } = await import(
      '../sniper/execution-audit.js'
    );

    const base = {
      version: 1 as const,
      executionId: 'exec-states-1',
      planId: 'plan-1',
      planInstanceId: 'instance-1',
      artifactId: 'artifact-1',
      createdAt:
        '2024-01-01T00:00:00.000Z',
      updatedAt:
        '2024-01-01T00:00:00.000Z',
      riskReservationId:
        'a'.repeat(32),
      transactionSignature:
        'sig-1',
      journalSha256:
        'c'.repeat(64),
    };

    await auditExecutionReady({
      ...base,
      status: 'ready',
    });

    await auditExecutionSubmitted({
      ...base,
      status: 'submitted',
    });

    const events =
      await readAuditEvents();

    assert.equal(
      events.length,
      2
    );

    assert.notEqual(
      events[0].event,
      events[1].event
    );
  }
);

test(
  'different journal hashes create different IDs',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      auditExecutionReady,
    } = await import(
      '../sniper/execution-audit.js'
    );

    const base = {
      version: 1 as const,
      executionId: 'exec-hash-1',
      planId: 'plan-1',
      planInstanceId: 'instance-1',
      artifactId: 'artifact-1',
      status: 'ready' as const,
      createdAt:
        '2024-01-01T00:00:00.000Z',
      updatedAt:
        '2024-01-01T00:00:00.000Z',
      riskReservationId:
        'a'.repeat(32),
      transactionSignature:
        'sig-1',
    };

    /*
     * Same execution ID and status, but different
     * journalSha256 (simulating a re-sealed journal
     * after a transition). Each must audit once.
     */
    await auditExecutionReady({
      ...base,
      journalSha256:
        'c'.repeat(64),
    });

    await auditExecutionReady({
      ...base,
      journalSha256:
        'd'.repeat(64),
    });

    const events =
      await readAuditEvents();

    assert.equal(
      events.length,
      2
    );
  }
);

test(
  'failed recovery after journal transition can safely re-run audit',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      auditExecutionFailed,
    } = await import(
      '../sniper/execution-audit.js'
    );

    const failedJournal = {
      version: 1 as const,
      executionId: 'exec-recover-1',
      planId: 'plan-1',
      planInstanceId: 'instance-1',
      artifactId: 'artifact-1',
      status: 'failed' as const,
      createdAt:
        '2024-01-01T00:00:00.000Z',
      updatedAt:
        '2024-01-01T00:00:04.000Z',
      riskReservationId:
        'a'.repeat(32),
      transactionSignature:
        'sig-1',
      failedAt:
        '2024-01-01T00:00:04.000Z',
      failedSlot: 600,
      failureReason: 'test failure',
      journalSha256:
        'c'.repeat(64),
    };

    /*
     * Simulate a crash after the journal transition
     * but before the audit. Re-running the audit
     * must succeed and write exactly one event.
     */
    const first =
      await auditExecutionFailed(
        failedJournal
      );

    assert.equal(
      first.written,
      true
    );

    /*
     * Re-run the audit (e.g. a recovery script).
     * Must be idempotent.
     */
    const second =
      await auditExecutionFailed(
        failedJournal
      );

    assert.equal(
      second.written,
      false
    );

    const events =
      await readAuditEvents();

    assert.equal(
      events.length,
      1
    );
  }
);

test(
  'audit output contains no private keys or raw transaction bytes',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      auditExecutionBroadcasting,
    } = await import(
      '../sniper/execution-audit.js'
    );

    const journal = {
      version: 1 as const,
      executionId: 'exec-redact-1',
      planId: 'plan-1',
      planInstanceId: 'instance-1',
      artifactId: 'artifact-1',
      status: 'broadcasting' as const,
      createdAt:
        '2024-01-01T00:00:00.000Z',
      updatedAt:
        '2024-01-01T00:00:01.000Z',
      riskReservationId:
        'a'.repeat(32),
      transactionSignature:
        'sig-redact-1',
      signedTransactionSha256:
        SIGNED_TX_SHA,
      transactionMessageSha256:
        MSG_SHA,
      lastValidBlockHeight:
        LAST_VALID_BLOCK_HEIGHT,
      broadcastPreparedAt:
        '2024-01-01T00:00:01.000Z',
      journalSha256:
        'c'.repeat(64),
    };

    await auditExecutionBroadcasting(
      journal
    );

    const content =
      await readFile(
        auditFile,
        'utf8'
      );

    /*
     * The audit must carry the signed-tx SHA and
     * message SHA (hashes, not bytes), but must
     * NOT carry any raw private key or transaction
     * bytes.
     */
    assert.match(
      content,
      /signedTransactionSha256/
    );

    assert.match(
      content,
      /transactionMessageSha256/
    );

    /*
     * No private key fields. The redact() function
     * in audit.ts already strips known secret names,
     * but we assert the audit payload simply
     * doesn't include them.
     */
    assert.doesNotMatch(
      content,
      /privateKey|secretKey|seed/i
    );
  }
);
