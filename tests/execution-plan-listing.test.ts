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
    join(tmpdir(), 'sniper-plan-listing-')
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
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS =
    '30';

  configured = true;
}

/**
 * Clean the plan directory before each test so count-based
 * assertions aren't polluted by plans from prior tests.
 * Config is cached at import time, so we can't use a fresh
 * dir per test — instead we delete all existing plans.
 */
async function cleanPlanDir() {
  await configureEnvironment();

  const {
    listApprovedExecutionPlans,
    deleteApprovedExecutionPlan,
  } = await import(
    '../sniper/execution-plan.js'
  );

  const existing =
    await listApprovedExecutionPlans();

  for (const plan of existing) {
    await deleteApprovedExecutionPlan(
      plan.planId
    );
  }
}

function buildPayload(
  overrides: Partial<{
    signature: string;
    exactMint: string;
    createdAt: string;
  }> = {}
) {
  return {
    signature:
      overrides.signature ??
      'sig-list-1',
    exactMint:
      overrides.exactMint ?? 'BASE_1',
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
  'listApprovedExecutionPlans returns plans sorted by createdAt ascending',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      listApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const oldest =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-old',
          createdAt: new Date(
            1_000_000
          ).toISOString(),
        })
      );

    const middle =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-mid',
          createdAt: new Date(
            2_000_000
          ).toISOString(),
        })
      );

    const newest =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-new',
          createdAt: new Date(
            3_000_000
          ).toISOString(),
        })
      );

    const plans =
      await listApprovedExecutionPlans();

    assert.equal(
      plans.length,
      3
    );

    assert.equal(
      plans[0].planId,
      oldest.planId
    );
    assert.equal(
      plans[1].planId,
      middle.planId
    );
    assert.equal(
      plans[2].planId,
      newest.planId
    );
  }
);

test(
  'prune removes expired prepared plans',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      pruneApprovedExecutionPlans,
      listApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    /*
     * MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS is 30.
     * Create a plan with createdAt 60s in the past
     * relative to nowMs = 2_000_000.
     */
    const expired =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-expired',
          createdAt: new Date(
            2_000_000 - 60_000
          ).toISOString(),
        })
      );

    const fresh =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-fresh',
          createdAt: new Date(
            2_000_000 - 5_000
          ).toISOString(),
        })
      );

    const results =
      await pruneApprovedExecutionPlans({
        nowMs: 2_000_000,
      });

    assert.equal(
      results.length,
      1
    );
    assert.equal(
      results[0].planId,
      expired.planId
    );
    assert.equal(
      results[0].reason,
      'expired'
    );
    assert.equal(
      results[0].previousStatus,
      'prepared'
    );

    const remaining =
      await listApprovedExecutionPlans();

    assert.equal(
      remaining.length,
      1
    );
    assert.equal(
      remaining[0].planId,
      fresh.planId
    );
  }
);

test(
  'prune does not remove simulated plans when alsoPruneFinishedAfterMs is not set',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      markApprovedExecutionPlanSimulated,
      pruneApprovedExecutionPlans,
      listApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-sim-keep',
          createdAt: new Date(
            1_000_000
          ).toISOString(),
        })
      );

    await markApprovedExecutionPlanSimulated(
      created.planId,
      'sim-ok'
    );

    /*
     * nowMs is far in the future, but without
     * alsoPruneFinishedAfterMs the simulated plan
     * should survive.
     */
    const results =
      await pruneApprovedExecutionPlans({
        nowMs: 100_000_000,
      });

    assert.equal(
      results.length,
      0
    );

    const remaining =
      await listApprovedExecutionPlans();

    assert.equal(
      remaining.length,
      1
    );
    assert.equal(
      remaining[0].state.status,
      'simulated'
    );
  }
);

test(
  'prune removes old simulated plans when alsoPruneFinishedAfterMs is set',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      markApprovedExecutionPlanSimulated,
      pruneApprovedExecutionPlans,
      listApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-sim-prune',
          createdAt: new Date(
            1_000_000
          ).toISOString(),
        })
      );

    await markApprovedExecutionPlanSimulated(
      created.planId,
      'sim-ok'
    );

    /*
     * The simulated transition sets simulatedAt to ~now.
     * Use a nowMs 10s in the future and a 5s threshold
     * so the simulated plan (aged ~10s) is pruned.
     */
    const simulatedAt =
      Date.now();

    const results =
      await pruneApprovedExecutionPlans({
        nowMs: simulatedAt + 10_000,
        alsoPruneFinishedAfterMs: 5_000,
      });

    assert.equal(
      results.length,
      1
    );
    assert.equal(
      results[0].planId,
      created.planId
    );
    assert.equal(
      results[0].reason,
      'finished'
    );
    assert.equal(
      results[0].previousStatus,
      'simulated'
    );

    const remaining =
      await listApprovedExecutionPlans();

    assert.equal(
      remaining.length,
      0
    );
  }
);

test(
  'prune removes old cancelled plans when alsoPruneFinishedAfterMs is set',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      cancelApprovedExecutionPlan,
      pruneApprovedExecutionPlans,
      listApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-cancel-prune',
          createdAt: new Date(
            1_000_000
          ).toISOString(),
        })
      );

    await cancelApprovedExecutionPlan(
      created.planId,
      'test cancel'
    );

    const cancelledAt =
      Date.now();

    const results =
      await pruneApprovedExecutionPlans({
        nowMs: cancelledAt + 10_000,
        alsoPruneFinishedAfterMs: 5_000,
      });

    assert.equal(
      results.length,
      1
    );
    assert.equal(
      results[0].planId,
      created.planId
    );
    assert.equal(
      results[0].reason,
      'finished'
    );
    assert.equal(
      results[0].previousStatus,
      'cancelled'
    );

    const remaining =
      await listApprovedExecutionPlans();

    assert.equal(
      remaining.length,
      0
    );
  }
);

test(
  'prune leaves fresh prepared plans alone',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      pruneApprovedExecutionPlans,
      listApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const fresh =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-fresh-keep',
          createdAt: new Date(
            2_000_000 - 5_000
          ).toISOString(),
        })
      );

    const results =
      await pruneApprovedExecutionPlans({
        nowMs: 2_000_000,
      });

    assert.equal(
      results.length,
      0
    );

    const remaining =
      await listApprovedExecutionPlans();

    assert.equal(
      remaining.length,
      1
    );
    assert.equal(
      remaining[0].planId,
      fresh.planId
    );
  }
);
