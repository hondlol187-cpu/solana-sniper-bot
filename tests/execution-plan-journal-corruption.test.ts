import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-journal-corruption-')
  );

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';
  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_DIR =
    join(dir, 'plans');
  process.env.AUDIT_FILE =
    join(dir, 'audit.jsonl');
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS =
    '30';

  configured = true;
}

async function cleanAll() {
  await configureEnvironment();

  const {
    scanApprovedExecutionPlans,
    deleteApprovedExecutionPlan,
    getApprovedExecutionPlanPath,
  } = await import(
    '../sniper/execution-plan.js'
  );

  const { valid, invalid } =
    await scanApprovedExecutionPlans();

  for (const plan of valid) {
    await deleteApprovedExecutionPlan(
      plan.planId,
      { recordTombstone: false }
    );
  }

  for (const inv of invalid) {
    await rm(inv.path, { force: true });
    await rm(
      getApprovedExecutionPlanPath(
        inv.planId
      ) + '.lock',
      { force: true }
    );
  }

  const planDir =
    process.env.APPROVED_EXECUTION_PLAN_DIR!;

  await rm(
    join(planDir, 'tombstones'),
    {
      recursive: true,
      force: true,
    }
  );

  await rm(
    join(planDir, 'tombstones.jsonl'),
    { force: true }
  );

  await rm(
    join(planDir, 'deletion-journals'),
    {
      recursive: true,
      force: true,
    }
  );

  await rm(
    process.env.AUDIT_FILE!,
    { force: true }
  );
}

function buildPayload(
  overrides: Partial<{
    signature: string;
    createdAt: string;
  }> = {}
) {
  return {
    signature:
      overrides.signature ??
      'sig-jc-1',
    exactMint: 'BASE_1',
    createdAt:
      overrides.createdAt ??
      new Date(1_000_000).toISOString(),
    quoteReceivedAtMs: 995_000,

    walletPublicKey:
      '11111111111111111111111111111111',
    expectedCluster:
      'mainnet-beta',
    buyLamports:
      '10000000',

    approvedPoolAddress:
      'POOL_1',
    approvedQuoteMint:
      'So11111111111111111111111111111111111111112',
    approvedLiquiditySol: 100,

    currentPoolAddress:
      'POOL_1',
    currentQuoteMint:
      'So11111111111111111111111111111111111111112',
    currentLiquiditySol: 90,

    routeHopCount: 1,
    routeLabels: ['Raydium AMM'],
    routeAmmKeys: ['POOL_1'],

    quoteInputMint:
      'So11111111111111111111111111111111111111112',
    quoteOutputMint: 'BASE_1',
    quoteInAmount: '10000000',
    quoteOutAmount: '123456',
    quoteOtherAmountThreshold: '120000',
    quoteSlippageBps: 150,
    quotePriceImpactPct: '0.5',
    quoteRoutePlan: [],

    routeOk: true,
    routeReasons: [],
    approvalOk: true,
    approvalReasons: [],
    quoteAgeMs: 1000,
    liquidityDropPct: 10,
  };
}

test(
  'malformed JSON is reported by scanDeletionJournals',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { mkdir } = await import(
      'node:fs/promises'
    );

    const journalDir = join(
      process.env.APPROVED_EXECUTION_PLAN_DIR!,
      'deletion-journals'
    );

    await mkdir(journalDir, {
      recursive: true,
      mode: 0o700,
    });

    /*
     * Write a file with invalid JSON.
     */
    await writeFile(
      join(journalDir, 'bad.json'),
      '{ this is not valid json',
      'utf8'
    );

    const {
      scanDeletionJournals,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const { valid, invalid } =
      await scanDeletionJournals();

    assert.equal(valid.length, 0);
    assert.equal(invalid.length, 1);
    assert.match(
      invalid[0].error,
      /JSON|Unexpected/
    );
  }
);

test(
  'invalid deletion ID is reported by scanDeletionJournals',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { mkdir } = await import(
      'node:fs/promises'
    );

    const journalDir = join(
      process.env.APPROVED_EXECUTION_PLAN_DIR!,
      'deletion-journals'
    );

    await mkdir(journalDir, {
      recursive: true,
      mode: 0o700,
    });

    /*
     * Write a journal with an invalid deletionId
     * (not 32 hex chars).
     */
    const badJournal = {
      deletionId: 'not-a-valid-id',
      planId: 'some-plan',
      planInstanceId:
        'some-instance',
      planSha256:
        'a'.repeat(64),
      deleteReason: 'test',
      status: 'pending',
      createdAt:
        new Date().toISOString(),
    };

    await writeFile(
      join(journalDir, `${badJournal.deletionId}.json`),
      JSON.stringify(badJournal, null, 2),
      'utf8'
    );

    const {
      scanDeletionJournals,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const { valid, invalid } =
      await scanDeletionJournals();

    assert.equal(valid.length, 0);
    assert.equal(invalid.length, 1);
    assert.match(
      invalid[0].error,
      /deletionId/
    );
  }
);

test(
  'missing ledger fields are rejected by status validation',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { mkdir } = await import(
      'node:fs/promises'
    );

    const journalDir = join(
      process.env.APPROVED_EXECUTION_PLAN_DIR!,
      'deletion-journals'
    );

    await mkdir(journalDir, {
      recursive: true,
      mode: 0o700,
    });

    /*
     * Write a ledger-recorded journal without
     * ledgerSequence or ledgerEntryHash.
     */
    const badJournal = {
      deletionId: 'a'.repeat(32),
      planId: 'some-plan',
      planInstanceId:
        'some-instance',
      planSha256:
        'b'.repeat(64),
      deleteReason: 'test',
      status: 'ledger-recorded',
      createdAt:
        new Date().toISOString(),
      /*
       * Missing: ledgerSequence, ledgerEntryHash
       */
    };

    await writeFile(
      join(journalDir, `${badJournal.deletionId}.json`),
      JSON.stringify(badJournal, null, 2),
      'utf8'
    );

    const {
      scanDeletionJournals,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const { valid, invalid } =
      await scanDeletionJournals();

    assert.equal(valid.length, 0);
    assert.equal(invalid.length, 1);
    assert.match(
      invalid[0].error,
      /ledgerSequence/
    );
  }
);

test(
  'crash after audit does not duplicate the audit event',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      preparePlanDeletion,
      readAllJournals,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-jc-dedup',
        })
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * First call — completes the full transaction.
     */
    await preparePlanDeletion(
      file,
      'first-attempt'
    );

    /*
     * Count audit events for this plan.
     */
    const auditContent =
      await readFile(
        process.env.AUDIT_FILE!,
        'utf8'
      );

    const planDeletedEvents =
      auditContent
        .trim()
        .split('\n')
        .filter((line) =>
          line.includes(
            'plan-deleted'
          )
        );

    assert.equal(
      planDeletedEvents.length,
      1
    );

    /*
     * Reset the journal to ledger-recorded
     * to simulate a crash after the audit
     * but before the journal commit.
     */
    const journals =
      await readAllJournals();

    const journal = journals[0];

    const ledgerRecordedJournal = {
      ...journal,
      status: 'ledger-recorded' as const,
      auditEventId: undefined,
      committedAt: undefined,
    };

    await writeFile(
      join(
        process.env.APPROVED_EXECUTION_PLAN_DIR!,
        'deletion-journals',
        `${journal.deletionId}.json`
      ),
      JSON.stringify(
        ledgerRecordedJournal,
        null,
        2
      ),
      'utf8'
    );

    /*
     * Second call — should resume from
     * ledger-recorded, call auditOnce
     * (which finds the existing event),
     * and NOT duplicate it.
     */
    await preparePlanDeletion(
      file,
      'second-attempt'
    );

    const auditContentAfter =
      await readFile(
        process.env.AUDIT_FILE!,
        'utf8'
      );

    const planDeletedEventsAfter =
      auditContentAfter
        .trim()
        .split('\n')
        .filter((line) =>
          line.includes(
            'plan-deleted'
          )
        );

    assert.equal(
      planDeletedEventsAfter.length,
      1,
      'Audit event must not be duplicated'
    );
  }
);

test(
  'recovery advances audit-recorded to committed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      preparePlanDeletion,
      readAllJournals,
      recoverPendingPlanDeletions,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-jc-audit-recorded',
        })
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * Complete the deletion transaction.
     */
    await preparePlanDeletion(
      file,
      'test'
    );

    /*
     * Reset the journal to audit-recorded.
     */
    const journals =
      await readAllJournals();

    const journal = journals[0];

    const auditRecordedJournal = {
      ...journal,
      status: 'audit-recorded' as const,
      committedAt: undefined,
    };

    await writeFile(
      join(
        process.env.APPROVED_EXECUTION_PLAN_DIR!,
        'deletion-journals',
        `${journal.deletionId}.json`
      ),
      JSON.stringify(
        auditRecordedJournal,
        null,
        2
      ),
      'utf8'
    );

    /*
     * Recover — should advance from
     * audit-recorded to committed.
     */
    const result =
      await recoverPendingPlanDeletions();

    assert.equal(
      result.recovered.length,
      1
    );

    const journalsAfter =
      await readAllJournals();

    assert.equal(
      journalsAfter[0].status,
      'committed'
    );
  }
);

test(
  'committed journal without ledger entry fails verification',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      preparePlanDeletion,
      verifyDeletionTransactions,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-jc-no-ledger',
        })
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * Complete the deletion transaction.
     */
    await preparePlanDeletion(
      file,
      'test'
    );

    /*
     * Remove the tombstone to simulate
     * a missing ledger entry.
     */
    const {
      readPlanTombstones,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const tombstones =
      await readPlanTombstones();

    await rm(
      join(
        process.env.APPROVED_EXECUTION_PLAN_DIR!,
        'tombstones',
        `${tombstones[0].deletionId}.json`
      ),
      { force: true }
    );

    const verification =
      await verifyDeletionTransactions();

    assert.equal(
      verification.ok,
      false
    );
    assert.ok(
      verification.errors.some(
        (e) =>
          e.includes(
            'no matching ledger entry'
          )
      )
    );
  }
);

test(
  'orphan ledger entry fails verification',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { mkdir } = await import(
      'node:fs/promises'
    );

    const {
      verifyDeletionTransactions,
    } = await import(
      '../sniper/plan-audit.js'
    );

    /*
     * Write a tombstone without a journal.
     */
    const tombstoneDir = join(
      process.env.APPROVED_EXECUTION_PLAN_DIR!,
      'tombstones'
    );

    await mkdir(tombstoneDir, {
      recursive: true,
      mode: 0o700,
    });

    const orphanTombstone = {
      sequence: 1,
      previousHash: null,
      entryHash: 'a'.repeat(64),
      deletionId: 'b'.repeat(32),
      planId: 'orphan-plan',
      finalStatus: 'prepared',
      deletedAt:
        new Date().toISOString(),
      deleteReason: 'orphan',
      sha256: 'c'.repeat(64),
      version: 3,
      walletPublicKey:
        '11111111111111111111111111111111',
      expectedCluster:
        'mainnet-beta',
    };

    await writeFile(
      join(
        tombstoneDir,
        `${orphanTombstone.deletionId}.json`
      ),
      JSON.stringify(
        orphanTombstone,
        null,
        2
      ),
      'utf8'
    );

    const verification =
      await verifyDeletionTransactions();

    assert.equal(
      verification.ok,
      false
    );
    assert.ok(
      verification.errors.some(
        (e) =>
          e.includes(
            'Orphan ledger entry'
          )
      )
    );
  }
);

test(
  'journal/ledger SHA mismatch fails verification',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      preparePlanDeletion,
      readPlanTombstones,
      verifyDeletionTransactions,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-jc-sha-mismatch',
        })
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    await preparePlanDeletion(
      file,
      'test'
    );

    /*
     * Tamper with the tombstone's sha256
     * to create a mismatch with the journal.
     */
    const tombstones =
      await readPlanTombstones();

    const tombstonePath = join(
      process.env.APPROVED_EXECUTION_PLAN_DIR!,
      'tombstones',
      `${tombstones[0].deletionId}.json`
    );

    const parsed = JSON.parse(
      await readFile(tombstonePath, 'utf8')
    );

    parsed.sha256 = 'd'.repeat(64);

    await writeFile(
      tombstonePath,
      JSON.stringify(parsed, null, 2),
      'utf8'
    );

    const verification =
      await verifyDeletionTransactions();

    assert.equal(
      verification.ok,
      false
    );
    assert.ok(
      verification.errors.some(
        (e) =>
          e.includes(
            'planSha256 mismatch'
          )
      )
    );
  }
);

test(
  'audit event without journal fails verification (via orphan ledger)',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * This test verifies that an orphan ledger
     * entry (which implies an audit event was
     * emitted without a journal) is detected.
     * The audit event itself is in the audit
     * file, but there's no journal linking it
     * to the deletion transaction.
     */

    const { mkdir } = await import(
      'node:fs/promises'
    );

    const {
      verifyDeletionTransactions,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const tombstoneDir = join(
      process.env.APPROVED_EXECUTION_PLAN_DIR!,
      'tombstones'
    );

    await mkdir(tombstoneDir, {
      recursive: true,
      mode: 0o700,
    });

    const orphanTombstone = {
      sequence: 1,
      previousHash: null,
      entryHash: 'e'.repeat(64),
      deletionId: 'f'.repeat(32),
      planId: 'audit-without-journal',
      finalStatus: 'prepared',
      deletedAt:
        new Date().toISOString(),
      deleteReason: 'orphan-audit',
      sha256: '1'.repeat(64),
      version: 3,
      walletPublicKey:
        '11111111111111111111111111111111',
      expectedCluster:
        'mainnet-beta',
    };

    await writeFile(
      join(
        tombstoneDir,
        `${orphanTombstone.deletionId}.json`
      ),
      JSON.stringify(
        orphanTombstone,
        null,
        2
      ),
      'utf8'
    );

    const verification =
      await verifyDeletionTransactions();

    assert.equal(
      verification.ok,
      false
    );
    assert.ok(
      verification.errors.some(
        (e) =>
          e.includes(
            'Orphan ledger entry'
          ) ||
          e.includes(
            'no matching journal'
          )
      )
    );
  }
);

test(
  'doctor exits unhealthy for malformed journals',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { mkdir } = await import(
      'node:fs/promises'
    );

    const journalDir = join(
      process.env.APPROVED_EXECUTION_PLAN_DIR!,
      'deletion-journals'
    );

    await mkdir(journalDir, {
      recursive: true,
      mode: 0o700,
    });

    /*
     * Write a malformed journal.
     */
    await writeFile(
      join(journalDir, 'malformed.json'),
      '{ invalid json',
      'utf8'
    );

    const {
      assessDeletionJournalHealth,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const health =
      await assessDeletionJournalHealth();

    assert.equal(
      health.invalid,
      1
    );
    assert.ok(
      health.invalid > 0
    );
    assert.equal(
      health.invalidJournals.length,
      1
    );
  }
);

test(
  'recovery refuses malformed journal state',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { mkdir } = await import(
      'node:fs/promises'
    );

    const journalDir = join(
      process.env.APPROVED_EXECUTION_PLAN_DIR!,
      'deletion-journals'
    );

    await mkdir(journalDir, {
      recursive: true,
      mode: 0o700,
    });

    /*
     * Write a malformed journal.
     */
    await writeFile(
      join(journalDir, 'malformed.json'),
      '{ invalid json',
      'utf8'
    );

    const {
      recoverPendingPlanDeletions,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const result =
      await recoverPendingPlanDeletions();

    assert.equal(
      result.malformed.length,
      1
    );
    assert.equal(
      result.recovered.length,
      0
    );
  }
);

test(
  'legacy deletion helper delegates to preparePlanDeletion',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      deleteApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      recordPlanDeletionOnce,
      readAllJournals,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-jc-legacy',
        })
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * Call the legacy helper. It must
     * delegate to preparePlanDeletion
     * and produce a committed journal.
     */
    await recordPlanDeletionOnce(
      file,
      'legacy-call'
    );

    const journals =
      await readAllJournals();

    assert.equal(
      journals.length,
      1
    );
    assert.equal(
      journals[0].status,
      'committed'
    );

    /*
     * Clean up the plan file (it wasn't
     * removed by recordPlanDeletionOnce
     * — only preparePlanDeletion was called,
     * not deleteApprovedExecutionPlan).
     */
    await deleteApprovedExecutionPlan(
      created.planId,
      { recordTombstone: false }
    );
  }
);
