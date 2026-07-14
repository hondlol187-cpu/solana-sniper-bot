import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;
let planDir: string;
let auditFile: string;

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
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS =
    '30';

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
}

const SIGNED_TX_SHA = 'a'.repeat(64);
const MSG_SHA = 'b'.repeat(64);
const LAST_VALID_BLOCK_HEIGHT = 200_000_000;

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

    /*
     * Build a submitted journal, then reconcile it to confirmed.
     */
    const journalA =
      await beginExecution(
        'plan-confirmed-audit',
        'instance-confirmed-audit',
        'artifact-confirmed-audit'
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
