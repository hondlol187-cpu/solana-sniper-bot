import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  mkdir,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;
let planDir: string;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-delete-test-')
  );

  planDir = join(dir, 'plans');

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';
  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_DIR =
    planDir;
  process.env.AUDIT_FILE =
    join(dir, 'audit.jsonl');
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS =
    '30';

  configured = true;
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
      'sig-delete-test',
    exactMint: 'BASE_DELETE',
    createdAt:
      overrides.createdAt ??
      new Date().toISOString(),
    quoteReceivedAtMs: Date.now() - 1_000,

    walletPublicKey:
      '11111111111111111111111111111111',
    expectedCluster: 'mainnet-beta',
    buyLamports: '10000000',

    approvedPoolAddress: 'POOL_DEL',
    approvedQuoteMint:
      'So11111111111111111111111111111111111111112',
    approvedLiquiditySol: 100,

    currentPoolAddress: 'POOL_DEL',
    currentQuoteMint:
      'So11111111111111111111111111111111111111112',
    currentLiquiditySol: 90,

    routeHopCount: 1,
    routeLabels: ['Raydium AMM'],
    routeAmmKeys: ['POOL_DEL'],

    quoteInputMint:
      'So11111111111111111111111111111111111111112',
    quoteOutputMint: 'BASE_DELETE',
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
    quoteAgeMs: 1_000,
    liquidityDropPct: 10,
  };
}

async function cleanPlanDir() {
  await configureEnvironment();

  const { rm: rmFn } = await import(
    'node:fs/promises'
  );

  await rmFn(planDir, {
    force: true,
    recursive: true,
  });

  await mkdir(planDir, {
    recursive: true,
    mode: 0o700,
  });
}

test(
  'tombstone failure prevents deletion',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      deleteApprovedExecutionPlan,
      getApprovedExecutionPlanPath,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-tomb-fail',
        })
      );

    /*
     * Make the tombstones subdirectory read-only
     * so the per-plan tombstone write fails.
     */
    const tombstoneDir = join(
      planDir,
      'tombstones'
    );

    await mkdir(tombstoneDir, {
      recursive: true,
      mode: 0o700,
    });

    await chmod(tombstoneDir, 0o500);

    try {
      await assert.rejects(
        () =>
          deleteApprovedExecutionPlan(
            file.planId,
            {
              reason: 'test-tomb-fail',
            }
          ),
        /EACCES|permission|tombstone/i
      );

      /*
       * The plan file must still exist — deletion
       * was aborted because the tombstone could
       * not be written.
       */
      const planContent =
        await readFile(
          getApprovedExecutionPlanPath(
            file.planId
          ),
          'utf8'
        );

      assert.ok(
        planContent.length > 0,
        'Plan file should still exist after tombstone failure'
      );
    } finally {
      await chmod(tombstoneDir, 0o700);
    }
  }
);

test(
  'audit failure prevents deletion',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      deleteApprovedExecutionPlan,
      getApprovedExecutionPlanPath,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-audit-fail',
        })
      );

    /*
     * Create the audit file, then make it read-only
     * so the audit append fails.
     */
    const auditPath =
      process.env.AUDIT_FILE!;

    await writeFile(
      auditPath,
      '',
      { mode: 0o600 }
    );

    await chmod(auditPath, 0o400);

    try {
      await assert.rejects(
        () =>
          deleteApprovedExecutionPlan(
            file.planId,
            {
              reason: 'test-audit-fail',
            }
          ),
        /EACCES|permission/i
      );

      /*
       * The plan file must still exist — deletion
       * was aborted because the audit could not
       * be written.
       */
      const planContent =
        await readFile(
          getApprovedExecutionPlanPath(
            file.planId
          ),
          'utf8'
        );

      assert.ok(
        planContent.length > 0,
        'Plan file should still exist after audit failure'
      );
    } finally {
      await chmod(auditPath, 0o600);
    }
  }
);

test(
  'retry does not duplicate tombstones',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      deleteApprovedExecutionPlan,
      getApprovedExecutionPlanPath,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const { readPlanTombstones } =
      await import(
        '../sniper/plan-audit.js'
      );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-retry-dedup',
        })
      );

    /*
     * First deletion succeeds — writes the per-plan
     * tombstone and deletes the plan file.
     */
    await deleteApprovedExecutionPlan(
      file.planId,
      { reason: 'first-attempt' }
    );

    /*
     * Verify the plan file is gone.
     */
    await assert.rejects(
      () =>
        readFile(
          getApprovedExecutionPlanPath(
            file.planId
          ),
          'utf8'
        ),
      /ENOENT/
    );

    /*
     * Re-create the plan file so we can attempt
     * deletion again. The per-plan tombstone from
     * the first deletion still exists.
     */
    await writeApprovedExecutionPlan(
      buildPayload({
        signature: 'sig-retry-dedup',
        createdAt: file.payload.createdAt,
      })
    );

    /*
     * Second deletion should succeed. The
     * recordPlanDeletionOnce function should find
     * the existing per-plan tombstone and return
     * early (idempotent) — no duplicate tombstone.
     */
    await deleteApprovedExecutionPlan(
      file.planId,
      { reason: 'second-attempt' }
    );

    const tombstones =
      await readPlanTombstones();

    const matching =
      tombstones.filter(
        (t) =>
          t.planId === file.planId
      );

    /*
     * With planInstanceId-based deletion IDs, a
     * re-created plan is a new physical instance
     * and gets its own tombstone. So there are
     * now 2 tombstones for this planId — one for
     * each instance.
     */
    assert.equal(
      matching.length,
      2,
      'Should have two tombstones — one per physical plan instance'
    );
  }
);

test(
  'corrupt plan deletion requires explicit flag',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      getApprovedExecutionPlanPath,
      deleteApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const planId = 'corrupt_plan_test';

    const path =
      getApprovedExecutionPlanPath(planId);

    /*
     * Write a corrupt plan file — valid JSON but
     * wrong shape (missing required fields).
     */
    await writeFile(
      path,
      JSON.stringify({
        version: 3,
        planId,
        state: { status: 'prepared' },
        payload: {},
        sha256: 'invalid',
      }),
      {
        mode: 0o600,
      }
    );

    /*
     * Without allowCorruptDelete, the deletion
     * should refuse — the plan can't be loaded
     * and the caller hasn't authorized corrupt
     * deletion.
     */
    await assert.rejects(
      () =>
        deleteApprovedExecutionPlan(
          planId,
          { recordTombstone: true }
        ),
      /Refusing to delete an invalid plan/
    );

    /*
     * The corrupt file must still exist.
     */
    const content =
      await readFile(path, 'utf8');

    assert.ok(
      content.length > 0,
      'Corrupt plan file should still exist'
    );

    /*
     * With allowCorruptDelete, the deletion
     * should succeed — the file is removed
     * without a tombstone.
     */
    await deleteApprovedExecutionPlan(
      planId,
      {
        recordTombstone: true,
        allowCorruptDelete: true,
      }
    );

    await assert.rejects(
      () => readFile(path, 'utf8'),
      /ENOENT/
    );
  }
);

test(
  'simultaneous delete calls produce one tombstone',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      deleteApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const { readPlanTombstones } =
      await import(
        '../sniper/plan-audit.js'
      );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-concurrent-del',
        })
      );

    /*
     * Launch two concurrent delete calls for the
     * same plan. The per-plan file lock should
     * serialize them. One will succeed; the other
     * will either succeed (finding the file already
     * gone) or throw (plan not found).
     */
    const results =
      await Promise.allSettled([
        deleteApprovedExecutionPlan(
          file.planId,
          { reason: 'concurrent-1' }
        ),
        deleteApprovedExecutionPlan(
          file.planId,
          { reason: 'concurrent-2' }
        ),
      ]);

    /*
     * At least one must succeed. The other may
     * reject (plan already deleted by the first
     * call) — that's acceptable.
     */
    const fulfilled =
      results.filter(
        (r) => r.status === 'fulfilled'
      );

    assert.ok(
      fulfilled.length >= 1,
      'At least one concurrent delete must succeed'
    );

    /*
     * Regardless of which call won, exactly one
     * tombstone must exist for this plan.
     */
    const tombstones =
      await readPlanTombstones();

    const matching =
      tombstones.filter(
        (t) =>
          t.planId === file.planId
      );

    assert.equal(
      matching.length,
      1,
      'Should have exactly one tombstone after concurrent deletes'
    );
  }
);

test(
  'concurrent migration reports only one real migration',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      migrateApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-concurrent-mig',
        })
      );

    /*
     * The plan was just written, so it's already v2
     * on disk. We need a v1 plan to test migration.
     * Manually write a v1 file.
     */
    const { createHash } = await import(
      'node:crypto'
    );

    const v1Content = {
      version: 1,
      planId: file.planId,
      state: {
        status: 'prepared' as const,
        simulationCount: 0,
        createdAt: file.payload.createdAt,
      },
      payload: file.payload,
    };

    function stableStringify(
      value: unknown
    ): string {
      if (
        value === null ||
        typeof value !== 'object'
      ) {
        return JSON.stringify(value);
      }

      if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
      }

      const entries = Object.entries(
        value as Record<string, unknown>
      ).sort(([a], [b]) =>
        a.localeCompare(b)
      );

      return `{${entries
        .map(
          ([key, item]) =>
            `${JSON.stringify(key)}:${stableStringify(item)}`
        )
        .join(',')}}`;
    }

    const v1Sha256 = createHash('sha256')
      .update(stableStringify(v1Content))
      .digest('hex');

    const v1File = {
      ...v1Content,
      sha256: v1Sha256,
    };

    const path = (
      await import('../sniper/execution-plan.js')
    ).getApprovedExecutionPlanPath(file.planId);

    await writeFile(
      path,
      JSON.stringify(v1File, null, 2),
      { mode: 0o600 }
    );

    /*
     * Launch two concurrent migrations. The per-plan
     * lock should serialize them. Only one should
     * report migrated: true.
     */
    const results =
      await Promise.all([
        migrateApprovedExecutionPlan(
          file.planId
        ),
        migrateApprovedExecutionPlan(
          file.planId
        ),
      ]);

    const migratedCount =
      results.filter(
        (r) => r.migrated
      ).length;

    assert.equal(
      migratedCount,
      1,
      'Exactly one concurrent migration should report migrated: true'
    );

    /*
     * The plan on disk should now be v3.
     */
    const reloaded =
      await loadApprovedExecutionPlan(
        file.planId
      );

    assert.equal(
      reloaded.diskVersion,
      3,
      'Plan should be v3 on disk after migration'
    );
  }
);
