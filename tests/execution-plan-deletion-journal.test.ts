import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  rm,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-deletion-journal-')
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

  /*
   * Clear tombstones, journals, and audit.
   */
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
      'sig-journal-1',
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
  'preparePlanDeletion produces a committed journal with ledger sequence',
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
          signature: 'sig-journal-commit',
        })
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    const journal =
      await preparePlanDeletion(
        file,
        'test-delete'
      );

    assert.equal(
      journal.status,
      'committed'
    );
    assert.ok(
      journal.ledgerSequence !==
        undefined
    );
    assert.ok(
      journal.ledgerEntryHash !==
        undefined
    );
    assert.ok(
      journal.committedAt !==
        undefined
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
  }
);

test(
  'retry reuses the same deletionId and does not allocate another sequence',
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
      readPlanTombstones,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-journal-retry',
        })
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * First call — produces committed journal.
     */
    const journal1 =
      await preparePlanDeletion(
        file,
        'test-delete'
      );

    assert.equal(
      journal1.status,
      'committed'
    );

    const seq1 =
      journal1.ledgerSequence;

    /*
     * Second call (retry) — must reuse the same
     * deletionId and NOT allocate a new sequence.
     */
    const journal2 =
      await preparePlanDeletion(
        file,
        'test-delete'
      );

    assert.equal(
      journal2.deletionId,
      journal1.deletionId
    );
    assert.equal(
      journal2.ledgerSequence,
      seq1
    );

    /*
     * Only one journal file on disk.
     */
    const journals =
      await readAllJournals();

    assert.equal(
      journals.length,
      1
    );

    /*
     * Only one tombstone in the ledger.
     */
    const tombstones =
      await readPlanTombstones();

    assert.equal(
      tombstones.length,
      1
    );
    assert.equal(
      tombstones[0].deletionId,
      journal1.deletionId
    );
  }
);

test(
  'plan SHA conflict fails closed (pending journal)',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      cancelApprovedExecutionPlan,
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
          signature: 'sig-journal-conflict',
        })
      );

    const file1 =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * Start a deletion — this creates a committed
     * journal with file1's sha256.
     */
    await preparePlanDeletion(
      file1,
      'first-attempt'
    );

    /*
     * Manually reset the journal to 'pending' to
     * simulate a crash mid-transaction (after the
     * journal was written but before the ledger
     * was appended).
     */
    const journals =
      await readAllJournals();

    const journal = journals[0];

    const { writeFile } = await import(
      'node:fs/promises'
    );

    const { join } = await import(
      'node:path'
    );

    const pendingJournal = {
      ...journal,
      status: 'pending' as const,
      ledgerSequence: undefined,
      ledgerEntryHash: undefined,
      committedAt: undefined,
    };

    const journalPath = join(
      process.env.APPROVED_EXECUTION_PLAN_DIR!,
      'deletion-journals',
      `${pendingJournal.deletionId}.json`
    );

    await writeFile(
      journalPath,
      JSON.stringify(
        pendingJournal,
        null,
        2
      ),
      'utf8'
    );

    /*
     * Now mutate the plan (simulate it) so its
     * sha256 changes.
     */
    await cancelApprovedExecutionPlan(
      created.planId,
      'sim-ok'
    );

    const file2 =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * The pending journal has file1.sha256, but
     * the plan now has file2.sha256. A retry via
     * preparePlanDeletion must throw — this is a
     * crash mid-transaction where the plan changed
     * underneath us.
     */
    await assert.rejects(
      () =>
        preparePlanDeletion(
          file2,
          'second-attempt'
        ),
      /SHA-256 conflict/
    );
  }
);

test(
  'only a committed journal permits plan removal',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      deleteApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-journal-remove',
        })
      );

    /*
     * deleteApprovedExecutionPlan internally calls
     * preparePlanDeletion and requires the journal
     * to be committed before rm. After deletion,
     * the plan file should be gone.
     */
    await deleteApprovedExecutionPlan(
      created.planId,
      { reason: 'test-removal' }
    );

    await assert.rejects(
      () =>
        loadApprovedExecutionPlan(
          created.planId
        ),
      /ENOENT|no such file/i
    );
  }
);

test(
  'simultaneous delete calls produce one tombstone',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      deleteApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      readPlanTombstones,
      readAllJournals,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-journal-concurrent',
        })
      );

    /*
     * Fire two deletes concurrently. The per-plan
     * lock serializes them — only one wins. Both
     * must see the same committed journal.
     */
    const results =
      await Promise.allSettled([
        deleteApprovedExecutionPlan(
          created.planId,
          { reason: 'concurrent-a' }
        ),
        deleteApprovedExecutionPlan(
          created.planId,
          { reason: 'concurrent-b' }
        ),
      ]);

    /*
     * At least one must succeed. The other may
     * succeed (if it sees the committed journal)
     * or fail (if the plan file is already gone).
     */
    const fulfilled =
      results.filter(
        (r) => r.status === 'fulfilled'
      );

    assert.ok(
      fulfilled.length >= 1,
      'at least one delete must succeed'
    );

    /*
     * Only one tombstone in the ledger regardless
     * of how many deletes succeeded.
     */
    const tombstones =
      await readPlanTombstones();

    assert.equal(
      tombstones.length,
      1
    );

    /*
     * Only one journal on disk.
     */
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
  }
);

test(
  'deletionId is included in the tombstone',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      deleteApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      readPlanTombstones,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-journal-tombstone-id',
        })
      );

    await deleteApprovedExecutionPlan(
      created.planId,
      { reason: 'test-id' }
    );

    const tombstones =
      await readPlanTombstones();

    assert.equal(
      tombstones.length,
      1
    );
    assert.ok(
      typeof tombstones[0]
        .deletionId === 'string'
    );
    assert.ok(
      tombstones[0].deletionId
        .length === 32
    );
  }
);

test(
  'recoverPendingPlanDeletions resumes pending journals',
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
      recoverPendingPlanDeletions,
      readAllJournals,
    } = await import(
      '../sniper/plan-audit.js'
    );

    void preparePlanDeletion;

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-journal-recover',
        })
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * Manually write a pending journal to simulate
     * a crash after step 3 (before ledger append).
     */
    const {
      createHash,
    } = await import('node:crypto');

    const deletionId = createHash('sha256')
      .update(file.planId)
      .digest('hex')
      .slice(0, 32);

    /*
     * Use the exported preparePlanDeletion to
     * create the journal, but then manually
     * rewrite it as 'pending' to simulate a
     * crash mid-transaction.
     */
    await preparePlanDeletion(
      file,
      'recover-test'
    );

    /*
     * Reset the journal to pending and remove
     * the tombstone to simulate a crash.
     */
    const journals =
      await readAllJournals();

    const journal = journals[0];

    const pendingJournal = {
      ...journal,
      status: 'pending' as const,
      ledgerSequence: undefined,
      ledgerEntryHash: undefined,
      committedAt: undefined,
    };

    /*
     * Write the pending journal directly.
     */
    const { writeFile } = await import(
      'node:fs/promises'
    );

    const { join } = await import(
      'node:path'
    );

    const journalPath = join(
      process.env.APPROVED_EXECUTION_PLAN_DIR!,
      'deletion-journals',
      `${pendingJournal.deletionId}.json`
    );

    await writeFile(
      journalPath,
      JSON.stringify(
        pendingJournal,
        null,
        2
      ),
      'utf8'
    );

    /*
     * Remove the tombstone to simulate a crash
     * before the ledger was written.
     */
    await rm(
      join(
        process.env.APPROVED_EXECUTION_PLAN_DIR!,
        'tombstones',
        `${file.planId}.json`
      ),
      { force: true }
    );

    await rm(
      join(
        process.env.APPROVED_EXECUTION_PLAN_DIR!,
        'tombstones.jsonl'
      ),
      { force: true }
    );

    /*
     * Now recover. The pending journal should be
     * resumed to committed.
     */
    const result =
      await recoverPendingPlanDeletions();

    assert.equal(
      result.recovered.length,
      1
    );
    assert.equal(
      result.pending.length,
      0
    );
    assert.equal(
      result.conflicts.length,
      0
    );

    /*
     * Verify the journal is now committed.
     */
    const recoveredJournals =
      await readAllJournals();

    assert.equal(
      recoveredJournals[0].status,
      'committed'
    );
  }
);

test(
  'recoverPendingPlanDeletions reports conflicts for SHA mismatch',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      cancelApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      preparePlanDeletion,
      recoverPendingPlanDeletions,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-journal-recover-conflict',
        })
      );

    const file1 =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * Create a committed journal with file1's sha.
     */
    const journal =
      await preparePlanDeletion(
        file1,
        'conflict-test'
      );

    /*
     * Mutate the plan so its sha256 changes.
     */
    await cancelApprovedExecutionPlan(
      created.planId,
      'sim-ok'
    );

    /*
     * Manually reset the journal to pending so
     * recovery will try to resume it.
     */
    const { writeFile } = await import(
      'node:fs/promises'
    );

    const { join } = await import(
      'node:path'
    );

    const pendingJournal = {
      ...journal,
      status: 'pending' as const,
      ledgerSequence: undefined,
      ledgerEntryHash: undefined,
      committedAt: undefined,
    };

    const journalPath = join(
      process.env.APPROVED_EXECUTION_PLAN_DIR!,
      'deletion-journals',
      `${pendingJournal.deletionId}.json`
    );

    await writeFile(
      journalPath,
      JSON.stringify(
        pendingJournal,
        null,
        2
      ),
      'utf8'
    );

    /*
     * Recovery should detect the SHA conflict
     * (journal has file1.sha256, plan now has
     * file2.sha256 after simulate).
     */
    const result =
      await recoverPendingPlanDeletions();

    assert.equal(
      result.conflicts.length,
      1
    );
    assert.equal(
      result.recovered.length,
      0
    );
  }
);

test(
  'doctor reports unhealthy when pending journals exist',
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
      assessDeletionJournalHealth,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-journal-doctor',
        })
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * Manually write a pending journal without
     * completing the deletion.
     */
    const {
      createHash,
    } = await import('node:crypto');

    const { writeFile } = await import(
      'node:fs/promises'
    );

    const { join } = await import(
      'node:path'
    );

    const deletionId = createHash('sha256')
      .update(`plan-deletion:${file.planInstanceId}`)
      .digest('hex')
      .slice(0, 32);

    const pendingJournal = {
      deletionId,
      planId: file.planId,
      planInstanceId:
        file.planInstanceId,
      planSha256: file.sha256,
      deleteReason: 'test-pending',
      status: 'pending' as const,
      createdAt:
        new Date().toISOString(),
    };

    const journalPath = join(
      process.env.APPROVED_EXECUTION_PLAN_DIR!,
      'deletion-journals',
      `${deletionId}.json`
    );

    /*
     * Ensure the directory exists.
     */
    const { mkdir } = await import(
      'node:fs/promises'
    );

    await mkdir(
      join(
        process.env.APPROVED_EXECUTION_PLAN_DIR!,
        'deletion-journals'
      ),
      {
        recursive: true,
        mode: 0o700,
      }
    );

    await writeFile(
      journalPath,
      JSON.stringify(
        pendingJournal,
        null,
        2
      ),
      'utf8'
    );

    const health =
      await assessDeletionJournalHealth();

    assert.equal(
      health.pending,
      1
    );
    assert.equal(
      health.total,
      1
    );
    assert.ok(
      health.pending > 0
    );
  }
);
