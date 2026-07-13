import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  rm,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-plan-instance-')
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
      'sig-instance-1',
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
  'new plans get a unique planInstanceId',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const plan1 =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-instance-a',
        })
      );

    const plan2 =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-instance-b',
        })
      );

    assert.ok(
      typeof plan1.planInstanceId ===
        'string'
    );
    assert.ok(
      plan1.planInstanceId.length > 0
    );
    assert.ok(
      typeof plan2.planInstanceId ===
        'string'
    );
    assert.notEqual(
      plan1.planInstanceId,
      plan2.planInstanceId
    );
  }
);

test(
  'recreated logical plan gets a different instance ID',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      deleteApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const payload = buildPayload({
      signature: 'sig-recreate',
    });

    const plan1 =
      await writeApprovedExecutionPlan(
        payload
      );

    await deleteApprovedExecutionPlan(
      plan1.planId,
      { reason: 'first' }
    );

    /*
     * Re-create the plan with the same payload.
     * The planId will be the same (deterministic
     * from signature+mint+createdAt+wallet), but
     * the planInstanceId must be different.
     */
    const plan2 =
      await writeApprovedExecutionPlan(
        payload
      );

    assert.equal(
      plan2.planId,
      plan1.planId
    );
    assert.notEqual(
      plan2.planInstanceId,
      plan1.planInstanceId
    );
  }
);

test(
  'two deletions of recreated plans get different deletion IDs',
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
      readAllJournals,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const payload = buildPayload({
      signature: 'sig-recreate-delete',
    });

    const plan1 =
      await writeApprovedExecutionPlan(
        payload
      );

    await deleteApprovedExecutionPlan(
      plan1.planId,
      { reason: 'first' }
    );

    const plan2 =
      await writeApprovedExecutionPlan(
        payload
      );

    await deleteApprovedExecutionPlan(
      plan2.planId,
      { reason: 'second' }
    );

    const journals =
      await readAllJournals();

    assert.equal(
      journals.length,
      2
    );

    assert.notEqual(
      journals[0].deletionId,
      journals[1].deletionId
    );
  }
);

test(
  'both deletions receive separate ledger sequences',
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

    const payload = buildPayload({
      signature: 'sig-seq-separate',
    });

    const plan1 =
      await writeApprovedExecutionPlan(
        payload
      );

    await deleteApprovedExecutionPlan(
      plan1.planId,
      { reason: 'first' }
    );

    const plan2 =
      await writeApprovedExecutionPlan(
        payload
      );

    await deleteApprovedExecutionPlan(
      plan2.planId,
      { reason: 'second' }
    );

    const tombstones =
      await readPlanTombstones();

    assert.equal(
      tombstones.length,
      2
    );

    assert.notEqual(
      tombstones[0].sequence,
      tombstones[1].sequence
    );

    /*
     * Sequences must be contiguous.
     */
    const sequences = tombstones
      .map((t) => t.sequence)
      .sort((a, b) => a - b);

    assert.equal(
      sequences[1],
      sequences[0] + 1
    );
  }
);

test(
  'retry of one deletion reuses its ID',
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
          signature: 'sig-retry-id',
        })
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    const journal1 =
      await preparePlanDeletion(
        file,
        'first-attempt'
      );

    const journal2 =
      await preparePlanDeletion(
        file,
        'second-attempt'
      );

    assert.equal(
      journal2.deletionId,
      journal1.deletionId
    );

    const journals =
      await readAllJournals();

    assert.equal(
      journals.length,
      1
    );
  }
);

test(
  'old tombstone remains intact when a new plan is deleted',
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

    const payload = buildPayload({
      signature: 'sig-old-intact',
    });

    const plan1 =
      await writeApprovedExecutionPlan(
        payload
      );

    await deleteApprovedExecutionPlan(
      plan1.planId,
      { reason: 'first' }
    );

    const tombstonesAfterFirst =
      await readPlanTombstones();

    assert.equal(
      tombstonesAfterFirst.length,
      1
    );

    const firstTombstoneSha =
      tombstonesAfterFirst[0].sha256;
    const firstTombstoneDeletionId =
      tombstonesAfterFirst[0].deletionId;

    /*
     * Re-create and delete again.
     */
    await writeApprovedExecutionPlan(
      payload
    );

    await deleteApprovedExecutionPlan(
      plan1.planId,
      { reason: 'second' }
    );

    const tombstonesAfterSecond =
      await readPlanTombstones();

    assert.equal(
      tombstonesAfterSecond.length,
      2
    );

    /*
     * The first tombstone must still exist
     * and be unchanged.
     */
    const firstStillExists =
      tombstonesAfterSecond.find(
        (t) =>
          t.deletionId ===
          firstTombstoneDeletionId
      );

    assert.ok(firstStillExists);
    assert.equal(
      firstStillExists.sha256,
      firstTombstoneSha
    );
  }
);

test(
  'identical recreated content still receives a new instance ID',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      deleteApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const payload = buildPayload({
      signature: 'sig-identical-recreate',
    });

    const plan1 =
      await writeApprovedExecutionPlan(
        payload
      );

    await deleteApprovedExecutionPlan(
      plan1.planId,
      { reason: 'first' }
    );

    /*
     * Re-create with the EXACT same payload.
     * The payload is identical, but because v3
     * includes planInstanceId in the hashed content,
     * the sha256 will differ (each instance has a
     * unique random planInstanceId). The key
     * assertion is that planInstanceId differs.
     */
    const plan2 =
      await writeApprovedExecutionPlan(
        payload
      );

    assert.notEqual(
      plan2.sha256,
      plan1.sha256
    );
    assert.notEqual(
      plan2.planInstanceId,
      plan1.planInstanceId
    );
  }
);

test(
  'v2 migration creates an instance ID',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      migrateApprovedExecutionPlan,
      getApprovedExecutionPlanPath,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      createHash,
    } = await import('node:crypto');

    const { writeFile } = await import(
      'node:fs/promises'
    );

    /*
     * Write a v3 plan, then manually rewrite
     * it as v2 on disk (without planInstanceId).
     */
    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-v2-migrate',
        })
      );

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

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * Construct a v2 file (no planInstanceId).
     */
    const v2Content = {
      version: 2 as const,
      planId: file.planId,
      state: file.state,
      payload: file.payload,
    };

    const v2Sha256 = createHash('sha256')
      .update(stableStringify(v2Content))
      .digest('hex');

    const v2File = {
      ...v2Content,
      sha256: v2Sha256,
    };

    const path =
      getApprovedExecutionPlanPath(
        file.planId
      );

    await writeFile(
      path,
      JSON.stringify(v2File, null, 2),
      { mode: 0o600 }
    );

    /*
     * Verify it loads as v2 on disk.
     */
    const v2Loaded =
      await loadApprovedExecutionPlan(
        file.planId
      );

    assert.equal(v2Loaded.diskVersion, 2);

    /*
     * Migrate to v3.
     */
    const result =
      await migrateApprovedExecutionPlan(
        file.planId
      );

    assert.equal(result.migrated, true);
    assert.equal(result.fromVersion, 2);
    assert.equal(result.toVersion, 3);
    assert.ok(
      typeof result.planInstanceId ===
        'string'
    );
    assert.ok(
      result.planInstanceId.length > 0
    );

    /*
     * Reload and verify v3 on disk with
     * planInstanceId.
     */
    const reloaded =
      await loadApprovedExecutionPlan(
        file.planId
      );

    assert.equal(reloaded.diskVersion, 3);
    assert.equal(
      reloaded.planInstanceId,
      result.planInstanceId
    );
  }
);

test(
  'plan-instance tampering fails hash verification',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      getApprovedExecutionPlanPath,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const { readFile, writeFile } = await import(
      'node:fs/promises'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-tamper-instance',
        })
      );

    const path =
      getApprovedExecutionPlanPath(
        created.planId
      );

    const parsed = JSON.parse(
      await readFile(path, 'utf8')
    );

    /*
     * Tamper with planInstanceId without
     * recomputing the hash.
     */
    parsed.planInstanceId =
      'tampered-instance-id';

    await writeFile(
      path,
      JSON.stringify(parsed, null, 2),
      'utf8'
    );

    await assert.rejects(
      () =>
        loadApprovedExecutionPlan(
          created.planId
        ),
      /hash mismatch/
    );
  }
);
