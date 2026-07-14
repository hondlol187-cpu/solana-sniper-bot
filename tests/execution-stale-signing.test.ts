import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;
let planDir: string;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(
      tmpdir(),
      'sniper-stale-signing-'
    )
  );

  planDir = join(dir, 'plans');

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
}

const PLAN_ID = 'test-plan-id';
const PLAN_INSTANCE_ID = 'test-instance-id';
const ARTIFACT_ID = 'test-artifact-id';

const SIGNED_TX_SHA = 'a'.repeat(64);
const MSG_SHA = 'b'.repeat(64);
const LAST_VALID_BLOCK_HEIGHT = 200_000_000;

test(
  'fresh signing journal cannot be failed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      failStaleSigningExecution,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal =
      await beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      );

    const signing =
      await markExecutionSigning(
        journal.executionId
      );

    const nowMs =
      Date.parse(
        signing.updatedAt
      ) +
      5_000;

    await assert.rejects(
      failStaleSigningExecution(
        journal.executionId,
        60_000,
        nowMs
      ),
      /not stale/i
    );
  }
);

test(
  'old signing journal becomes failed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      failStaleSigningExecution,
      loadExecutionJournal,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal =
      await beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      );

    const signing =
      await markExecutionSigning(
        journal.executionId
      );

    const nowMs =
      Date.parse(
        signing.updatedAt
      ) +
      120_000;

    const failed =
      await failStaleSigningExecution(
        journal.executionId,
        60_000,
        nowMs
      );

    assert.equal(
      failed.status,
      'failed'
    );

    assert.match(
      failed.failureReason ?? '',
      /abandoned before pre-broadcast evidence/i
    );

    const reloaded =
      await loadExecutionJournal(
        journal.executionId
      );

    assert.ok(reloaded);
    assert.equal(
      reloaded.status,
      'failed'
    );
  }
);

test(
  'ready cannot use stale-signing recovery',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      failStaleSigningExecution,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal =
      await beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      );

    await assert.rejects(
      failStaleSigningExecution(
        journal.executionId,
        60_000,
        Date.now() +
          120_000
      ),
      /Invalid execution transition/i
    );
  }
);

test(
  'broadcasting can never use stale-signing recovery',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
      failStaleSigningExecution,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal =
      await beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      );

    const signing =
      await markExecutionSigning(
        journal.executionId
      );

    await markExecutionBroadcastReady(
      journal.executionId,
      {
        transactionSignature:
          'broadcast-sig',
        signedTransactionSha256:
          SIGNED_TX_SHA,
        transactionMessageSha256:
          MSG_SHA,
        lastValidBlockHeight:
          LAST_VALID_BLOCK_HEIGHT,
      }
    );

    const nowMs =
      Date.parse(
        signing.updatedAt
      ) +
      120_000;

    await assert.rejects(
      failStaleSigningExecution(
        journal.executionId,
        60_000,
        nowMs
      ),
      /Invalid execution transition/i
    );
  }
);

test(
  'submitted and confirmed cannot use stale-signing recovery',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
      markExecutionSubmitted,
      markExecutionConfirmed,
      failStaleSigningExecution,
    } = await import(
      '../sniper/execution-journal.js'
    );

    /*
     * Submitted journal.
     */
    const journalA =
      await beginExecution(
        'plan-submitted',
        'instance-submitted',
        'artifact-submitted'
      );

    const signingA =
      await markExecutionSigning(
        journalA.executionId
      );

    await markExecutionBroadcastReady(
      journalA.executionId,
      {
        transactionSignature:
          'sig-a',
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
      'sig-a'
    );

    const nowMsA =
      Date.parse(
        signingA.updatedAt
      ) +
      120_000;

    await assert.rejects(
      failStaleSigningExecution(
        journalA.executionId,
        60_000,
        nowMsA
      ),
      /Invalid execution transition/i
    );

    /*
     * Confirmed journal.
     */
    const journalB =
      await beginExecution(
        'plan-confirmed',
        'instance-confirmed',
        'artifact-confirmed'
      );

    const signingB =
      await markExecutionSigning(
        journalB.executionId
      );

    await markExecutionBroadcastReady(
      journalB.executionId,
      {
        transactionSignature:
          'sig-b',
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
      'sig-b'
    );

    await markExecutionConfirmed(
      journalB.executionId
    );

    const nowMsB =
      Date.parse(
        signingB.updatedAt
      ) +
      120_000;

    await assert.rejects(
      failStaleSigningExecution(
        journalB.executionId,
        60_000,
        nowMsB
      ),
      /Invalid execution transition/i
    );
  }
);

test(
  'concurrent recovery allows one transition',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      failStaleSigningExecution,
      loadExecutionJournal,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal =
      await beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      );

    const signing =
      await markExecutionSigning(
        journal.executionId
      );

    const nowMs =
      Date.parse(
        signing.updatedAt
      ) +
      120_000;

    const results =
      await Promise.allSettled([
        failStaleSigningExecution(
          journal.executionId,
          60_000,
          nowMs
        ),
        failStaleSigningExecution(
          journal.executionId,
          60_000,
          nowMs
        ),
      ]);

    const fulfilled = results.filter(
      (r) =>
        r.status ===
        'fulfilled'
    );

    assert.equal(
      fulfilled.length,
      1,
      'exactly one recovery must succeed'
    );

    const reloaded =
      await loadExecutionJournal(
        journal.executionId
      );

    assert.ok(reloaded);
    assert.equal(
      reloaded.status,
      'failed'
    );
  }
);

test(
  'invalid time and threshold reject',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      failStaleSigningExecution,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal =
      await beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      );

    await markExecutionSigning(
      journal.executionId
    );

    /*
     * The threshold/nowMs validations throw synchronously
     * before transitionExecution is called, so wrap each
     * call in an async function to turn the throw into a
     * rejected promise that assert.rejects can observe.
     */
    const call = (
      minimumAgeMs: number,
      nowMs: number
    ) =>
      (async () =>
        failStaleSigningExecution(
          journal.executionId,
          minimumAgeMs,
          nowMs
        ))();

    /*
     * Threshold below 1_000ms is invalid.
     */
    await assert.rejects(
      call(500, Date.now()),
      /Minimum signing age is invalid/i
    );

    /*
     * Negative threshold is invalid.
     */
    await assert.rejects(
      call(-1, Date.now()),
      /Minimum signing age is invalid/i
    );

    /*
     * Non-integer threshold is invalid.
     */
    await assert.rejects(
      call(60_000.5, Date.now()),
      /Minimum signing age is invalid/i
    );

    /*
     * Negative nowMs is invalid.
     */
    await assert.rejects(
      call(60_000, -1),
      /Current time is invalid/i
    );

    /*
     * Non-integer nowMs is invalid.
     */
    await assert.rejects(
      call(
        60_000,
        Date.now() + 0.5
      ),
      /Current time is invalid/i
    );
  }
);
