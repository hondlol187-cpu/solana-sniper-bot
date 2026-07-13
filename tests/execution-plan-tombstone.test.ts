import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-tombstone-')
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

async function cleanPlanDir() {
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

  const { rm } = await import(
    'node:fs/promises'
  );

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
   * Also clear the tombstone file and per-plan tombstone
   * directory so tests start clean.
   */
  const { readPlanTombstones, writePlanTombstone } =
    await import(
      '../sniper/plan-audit.js'
    );

  void writePlanTombstone;

  const tombstonePath = join(
    process.env.APPROVED_EXECUTION_PLAN_DIR!,
    'tombstones.jsonl'
  );

  await rm(tombstonePath, {
    force: true,
  });

  /*
   * Also clean per-plan tombstone files.
   */
  const planTombstoneDir = join(
    process.env.APPROVED_EXECUTION_PLAN_DIR!,
    'tombstones'
  );

  await rm(planTombstoneDir, {
    force: true,
    recursive: true,
  });

  void readPlanTombstones;
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
      'sig-tombstone-1',
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
  'deleteApprovedExecutionPlan writes a tombstone with final status and sha256',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

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
          signature: 'sig-tomb-delete',
        })
      );

    await deleteApprovedExecutionPlan(
      created.planId,
      { reason: 'test-delete' }
    );

    const tombstones =
      await readPlanTombstones();

    assert.equal(
      tombstones.length,
      1
    );

    const t = tombstones[0];

    assert.equal(
      t.planId,
      created.planId
    );
    assert.equal(
      t.finalStatus,
      'prepared'
    );
    assert.equal(
      t.deleteReason,
      'test-delete'
    );
    assert.equal(
      t.sha256,
      created.sha256
    );
    assert.equal(
      t.version,
      3
    );
    assert.equal(
      t.walletPublicKey,
      '11111111111111111111111111111111'
    );
    assert.equal(
      t.expectedCluster,
      'mainnet-beta'
    );
    assert.ok(
      typeof t.deletedAt === 'string'
    );
  }
);

test(
  'deleteApprovedExecutionPlan with recordTombstone:false skips tombstone',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

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
          signature: 'sig-tomb-skip',
        })
      );

    await deleteApprovedExecutionPlan(
      created.planId,
      { recordTombstone: false }
    );

    const tombstones =
      await readPlanTombstones();

    assert.equal(
      tombstones.length,
      0
    );
  }
);

test(
  'prune writes tombstones for pruned plans with reason prefixed',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      pruneApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      readPlanTombstones,
    } = await import(
      '../sniper/plan-audit.js'
    );

    /*
     * Create an expired prepared plan.
     * nowMs = 2_000_000, threshold = 30s.
     */
    await writeApprovedExecutionPlan(
      buildPayload({
        signature: 'sig-tomb-prune',
        createdAt: new Date(
          2_000_000 - 60_000
        ).toISOString(),
      })
    );

    const results =
      await pruneApprovedExecutionPlans({
        nowMs: 2_000_000,
      });

    assert.equal(results.length, 1);

    const tombstones =
      await readPlanTombstones();

    assert.equal(
      tombstones.length,
      1
    );

    assert.equal(
      tombstones[0].finalStatus,
      'prepared'
    );
    assert.equal(
      tombstones[0].deleteReason,
      'pruned:expired'
    );
  }
);

test(
  'tombstones accumulate across multiple deletions',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

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

    const p1 =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-tomb-multi-1',
        })
      );

    const p2 =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-tomb-multi-2',
        })
      );

    await deleteApprovedExecutionPlan(
      p1.planId,
      { reason: 'first' }
    );

    await deleteApprovedExecutionPlan(
      p2.planId,
      { reason: 'second' }
    );

    const tombstones =
      await readPlanTombstones();

    assert.equal(
      tombstones.length,
      2
    );

    /*
     * Tombstones are append-only, so p1's tombstone
     * comes first, p2's second.
     */
    assert.equal(
      tombstones[0].planId,
      p1.planId
    );
    assert.equal(
      tombstones[0].deleteReason,
      'first'
    );
    assert.equal(
      tombstones[1].planId,
      p2.planId
    );
    assert.equal(
      tombstones[1].deleteReason,
      'second'
    );
  }
);

test(
  'auditPlanCreated emits consistent fields via shared event-builder',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      auditPlanCreated,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const { readFile } = await import(
      'node:fs/promises'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-audit-created',
        })
      );

    await auditPlanCreated(created);

    const auditContent =
      await readFile(
        process.env.AUDIT_FILE!,
        'utf8'
      );

    const lines = auditContent
      .trim()
      .split('\n');

    /*
     * Find the plan-created event (the last line
     * since we just emitted it).
     */
    const lastLine = JSON.parse(
      lines[lines.length - 1]
    );

    assert.equal(
      lastLine.event,
      'candidate.execution.plan-created'
    );

    /*
     * Verify the common fields are present.
     */
    assert.equal(
      lastLine.details.planId,
      created.planId
    );
    assert.equal(
      lastLine.details.planSha256,
      created.sha256
    );
    assert.equal(
      lastLine.details.status,
      'prepared'
    );
    assert.equal(
      lastLine.details.version,
      3
    );
    assert.equal(
      lastLine.details.walletPublicKey,
      '11111111111111111111111111111111'
    );
    assert.equal(
      lastLine.details.expectedCluster,
      'mainnet-beta'
    );
  }
);

test(
  'auditPlanDeleted emits consistent fields via shared event-builder',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      auditPlanDeleted,
    } = await import(
      '../sniper/plan-audit.js'
    );

    const { readFile } = await import(
      'node:fs/promises'
    );

    await auditPlanDeleted(
      'plan-test-deleted',
      'cancelled',
      'manual-cleanup',
      'abc123',
      3
    );

    const auditContent =
      await readFile(
        process.env.AUDIT_FILE!,
        'utf8'
      );

    const lines = auditContent
      .trim()
      .split('\n');

    const lastLine = JSON.parse(
      lines[lines.length - 1]
    );

    assert.equal(
      lastLine.event,
      'candidate.execution.plan-deleted'
    );
    assert.equal(
      lastLine.details.planId,
      'plan-test-deleted'
    );
    assert.equal(
      lastLine.details.finalStatus,
      'cancelled'
    );
    assert.equal(
      lastLine.details.deleteReason,
      'manual-cleanup'
    );
    assert.equal(
      lastLine.details.planSha256,
      'abc123'
    );
    assert.equal(
      lastLine.details.version,
      3
    );
  }
);
