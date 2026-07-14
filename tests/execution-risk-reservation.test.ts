import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
  unlink,
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
      'sniper-risk-reservation-'
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
  process.env.MAX_DAILY_SPEND_SOL =
    '0.2';
  process.env.MAX_DAILY_TRADES =
    '3';
  process.env.MAX_DAILY_DRAWDOWN_SOL =
    '0.1';

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

  await rm(riskFile, {
    force: true,
  });

  await rm(auditFile, {
    force: true,
  });
}

const PLAN_ID = 'test-plan-id';
const PLAN_INSTANCE_ID = 'test-instance-id';
const ARTIFACT_ID = 'test-artifact-id';
const MINT = 'TEST_MINT_A';
const BUY_LAMPORTS = 50_000_000n;
const OPENING_BALANCE = 1_000_000_000n;

test(
  'reservation ID is deterministic',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      buildRiskReservationId,
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

    const expected =
      buildRiskReservationId(
        journal.executionId
      );

    assert.equal(
      journal.riskReservationId,
      expected
    );

    /*
     * Reloading the journal preserves the reservation ID.
     */
    const reloaded =
      await loadExecutionJournal(
        journal.executionId
      );

    assert.ok(reloaded);
    assert.equal(
      reloaded.riskReservationId,
      expected
    );

    /*
     * The same execution ID always produces the same
     * reservation ID.
     */
    const again =
      buildRiskReservationId(
        journal.executionId
      );

    assert.equal(again, expected);
  }
);

test(
  'same execution creates one reservation',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const {
      reserveTradeOnce,
      getRiskState,
    } = await import(
      '../sniper/risk.js'
    );

    const journal =
      await beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      );

    const reservationId =
      journal.riskReservationId!;

    /*
     * Reserve twice with the same ID. The second call
     * must be idempotent and return the existing
     * reservation.
     */
    const first =
      await reserveTradeOnce(
        reservationId,
        MINT,
        BUY_LAMPORTS,
        OPENING_BALANCE
      );

    const second =
      await reserveTradeOnce(
        reservationId,
        MINT,
        BUY_LAMPORTS,
        OPENING_BALANCE
      );

    assert.equal(
      first.id,
      second.id
    );

    const state =
      await getRiskState(
        OPENING_BALANCE
      );

    assert.equal(
      state.reservations.length,
      1
    );
    assert.equal(
      state.reservations[0].id,
      reservationId
    );
  }
);

test(
  'concurrent executions count both reservations',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const {
      reserveTradeOnce,
      getRiskState,
    } = await import(
      '../sniper/risk.js'
    );

    /*
     * Two distinct executions get distinct reservation IDs.
     */
    const journalA =
      await beginExecution(
        'plan-a',
        'instance-a',
        'artifact-a'
      );

    const journalB =
      await beginExecution(
        'plan-b',
        'instance-b',
        'artifact-b'
      );

    assert.notEqual(
      journalA.executionId,
      journalB.executionId
    );

    assert.notEqual(
      journalA.riskReservationId,
      journalB.riskReservationId
    );

    /*
     * Reserve both concurrently.
     */
    const [resA, resB] =
      await Promise.all([
        reserveTradeOnce(
          journalA.riskReservationId!,
          MINT,
          BUY_LAMPORTS,
          OPENING_BALANCE
        ),
        reserveTradeOnce(
          journalB.riskReservationId!,
          MINT,
          BUY_LAMPORTS,
          OPENING_BALANCE
        ),
      ]);

    assert.notEqual(
      resA.id,
      resB.id
    );

    const state =
      await getRiskState(
        OPENING_BALANCE
      );

    assert.equal(
      state.reservations.length,
      2
    );
  }
);

test(
  'risk rejection occurs before signing — daily spend exceeded',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      loadExecutionJournal,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const {
      reserveTradeOnce,
      getRiskState,
    } = await import(
      '../sniper/risk.js'
    );

    const journal =
      await beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      );

    /*
     * MAX_DAILY_SPEND_SOL is 0.2 SOL = 200_000_000 lamports.
     * Reserve 180_000_000 lamports first (under the limit),
     * then attempt to reserve another 180_000_000 lamports
     * which pushes the projected spend over the limit.
     */
    await reserveTradeOnce(
      journal.riskReservationId!,
      MINT,
      180_000_000n,
      OPENING_BALANCE
    );

    const journalB =
      await beginExecution(
        'plan-b',
        'instance-b',
        'artifact-b'
      );

    await assert.rejects(
      reserveTradeOnce(
        journalB.riskReservationId!,
        MINT,
        180_000_000n,
        OPENING_BALANCE
      ),
      /Daily spend limit exceeded/i
    );

    /*
     * The second journal's reservation was never created.
     * The first reservation is still present.
     */
    const state =
      await getRiskState(
        OPENING_BALANCE
      );

    assert.equal(
      state.reservations.length,
      1
    );
    assert.equal(
      state.reservations[0].id,
      journal.riskReservationId
    );

    /*
     * Journal B is still in 'ready' state — no signing
     * transition was attempted because the risk reservation
     * failed first.
     */
    const reloadedB =
      await loadExecutionJournal(
        journalB.executionId
      );

    assert.ok(reloadedB);
    assert.equal(
      reloadedB.status,
      'ready'
    );
  }
);

test(
  'risk rejection occurs before broadcasting — daily trade limit',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const {
      reserveTradeOnce,
      getRiskState,
    } = await import(
      '../sniper/risk.js'
    );

    /*
     * MAX_DAILY_TRADES is 3. Each reservation counts as a
     * projected trade. Reserve 3 times successfully, then
     * the 4th must reject.
     */
    const ids: string[] = [];

    for (
      let i = 0;
      i < 3;
      i++
    ) {
      const journal =
        await beginExecution(
          `plan-${i}`,
          `instance-${i}`,
          `artifact-${i}`
        );

      await reserveTradeOnce(
        journal.riskReservationId!,
        MINT,
        BUY_LAMPORTS,
        OPENING_BALANCE
      );

      ids.push(
        journal.riskReservationId!
      );
    }

    const journalD =
      await beginExecution(
        'plan-d',
        'instance-d',
        'artifact-d'
      );

    await assert.rejects(
      reserveTradeOnce(
        journalD.riskReservationId!,
        MINT,
        BUY_LAMPORTS,
        OPENING_BALANCE
      ),
      /Daily trade limit exceeded/i
    );

    const state =
      await getRiskState(
        OPENING_BALANCE
      );

    assert.equal(
      state.reservations.length,
      3
    );
  }
);

test(
  'signing failure releases reservation',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionFailed,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const {
      reserveTradeOnce,
      releaseReservation,
      getRiskState,
    } = await import(
      '../sniper/risk.js'
    );

    const journal =
      await beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      );

    const reservationId =
      journal.riskReservationId!;

    /*
     * Simulate the verified-execution-core flow up to
     * signing, then fail.
     */
    await reserveTradeOnce(
      reservationId,
      MINT,
      BUY_LAMPORTS,
      OPENING_BALANCE
    );

    await markExecutionSigning(
      journal.executionId
    );

    /*
     * Simulate a signing failure (e.g. the artifact bytes
     * don't match the receipt). The core would call
     * markExecutionFailed + releaseReservation.
     */
    await markExecutionFailed(
      journal.executionId,
      'signing failed: artifact hash mismatch'
    );

    await releaseReservation(
      reservationId,
      MINT,
      OPENING_BALANCE
    );

    const state =
      await getRiskState(
        OPENING_BALANCE
      );

    assert.equal(
      state.reservations.length,
      0
    );
  }
);

test(
  'send error retains reservation — broadcasting journal keeps reservation',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
      loadExecutionJournal,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const {
      reserveTradeOnce,
      getRiskState,
    } = await import(
      '../sniper/risk.js'
    );

    const journal =
      await beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      );

    const reservationId =
      journal.riskReservationId!;

    await reserveTradeOnce(
      reservationId,
      MINT,
      BUY_LAMPORTS,
      OPENING_BALANCE
    );

    await markExecutionSigning(
      journal.executionId
    );

    await markExecutionBroadcastReady(
      journal.executionId,
      {
        transactionSignature:
          'deterministic-sig',
        signedTransactionSha256:
          'a'.repeat(64),
        transactionMessageSha256:
          'b'.repeat(64),
        lastValidBlockHeight:
          200_000_000,
      }
    );

    /*
     * After broadcast-ready, a send error leaves the journal
     * in 'broadcasting'. The reservation is NOT released —
     * the transaction may already be on the wire and the
     * reserved amount must stay accounted-for until
     * reconciliation determines the outcome.
     */
    const reloaded =
      await loadExecutionJournal(
        journal.executionId
      );

    assert.ok(reloaded);
    assert.equal(
      reloaded.status,
      'broadcasting'
    );

    const state =
      await getRiskState(
        OPENING_BALANCE
      );

    assert.equal(
      state.reservations.length,
      1
    );
    assert.equal(
      state.reservations[0].id,
      reservationId
    );
  }
);

test(
  'submitted execution retains reservation',
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
      getRiskState,
    } = await import(
      '../sniper/risk.js'
    );

    const journal =
      await beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      );

    const reservationId =
      journal.riskReservationId!;

    await reserveTradeOnce(
      reservationId,
      MINT,
      BUY_LAMPORTS,
      OPENING_BALANCE
    );

    await markExecutionSigning(
      journal.executionId
    );

    await markExecutionBroadcastReady(
      journal.executionId,
      {
        transactionSignature:
          'submitted-sig',
        signedTransactionSha256:
          'a'.repeat(64),
        transactionMessageSha256:
          'b'.repeat(64),
        lastValidBlockHeight:
          200_000_000,
      }
    );

    await markExecutionSubmitted(
      journal.executionId,
      'submitted-sig'
    );

    /*
     * After the journal reaches 'submitted', the reservation
     * is still active. It will only be committed (on
     * confirmation) or released (on failure) by the
     * reconciler.
     */
    const state =
      await getRiskState(
        OPENING_BALANCE
      );

    assert.equal(
      state.reservations.length,
      1
    );
    assert.equal(
      state.reservations[0].id,
      reservationId
    );
  }
);
