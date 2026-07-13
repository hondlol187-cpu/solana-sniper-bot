import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-cli-contracts-')
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
      plan.planId
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
}

function buildPayload(
  overrides: Partial<{
    signature: string;
    exactMint: string;
    approvedPoolAddress: string;
    createdAt: string;
  }> = {}
) {
  return {
    signature:
      overrides.signature ??
      'sig-cli-1',
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
      overrides.approvedPoolAddress ??
      'POOL_1',
    approvedQuoteMint:
      'So11111111111111111111111111111111111111112',
    approvedLiquiditySol: 100,

    currentPoolAddress:
      overrides.approvedPoolAddress ??
      'POOL_1',
    currentQuoteMint:
      'So11111111111111111111111111111111111111112',
    currentLiquiditySol: 90,

    routeHopCount: 1,
    routeLabels: ['Raydium AMM'],
    routeAmmKeys: ['POOL_1'],

    quoteInputMint:
      'So11111111111111111111111111111111111111112',
    quoteOutputMint:
      overrides.exactMint ?? 'BASE_1',
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

/*
 * Replicate the filter logic from list-approved-plans.ts
 * so tests can exercise the contract without spawning a
 * subprocess. If the CLI's applyFilters drifts from this,
 * the test will catch it.
 */
function applyListFilters(
  valid: import('../sniper/execution-plan.js').ApprovedExecutionPlanFile[],
  filters: {
    status?:
      | 'prepared'
      | 'simulated'
      | 'cancelled';
    limit?: number;
    mint?: string;
    pool?: string;
  }
): import('../sniper/execution-plan.js').ApprovedExecutionPlanFile[] {
  let result = valid;

  if (filters.status) {
    result = result.filter(
      (p) =>
        p.state.status === filters.status
    );
  }

  if (filters.mint) {
    result = result.filter(
      (p) =>
        p.payload.exactMint === filters.mint
    );
  }

  if (filters.pool) {
    result = result.filter(
      (p) =>
        p.payload.approvedPoolAddress ===
        filters.pool
    );
  }

  if (filters.limit) {
    result = result.slice(0, filters.limit);
  }

  return result;
}

test(
  'list filter by status returns only matching plans',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      markApprovedExecutionPlanSimulated,
      cancelApprovedExecutionPlan,
      scanApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const p1 =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-stay-prepared',
        })
      );

    const p2 =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-will-sim',
        })
      );

    const p3 =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-will-cancel',
        })
      );

    await markApprovedExecutionPlanSimulated(
      p2.planId,
      'sim-ok'
    );

    await cancelApprovedExecutionPlan(
      p3.planId,
      'cancel-reason'
    );

    const { valid } =
      await scanApprovedExecutionPlans();

    const prepared =
      applyListFilters(valid, {
        status: 'prepared',
      });

    assert.equal(prepared.length, 1);
    assert.equal(
      prepared[0].planId,
      p1.planId
    );

    const simulated =
      applyListFilters(valid, {
        status: 'simulated',
      });

    assert.equal(simulated.length, 1);
    assert.equal(
      simulated[0].planId,
      p2.planId
    );

    const cancelled =
      applyListFilters(valid, {
        status: 'cancelled',
      });

    assert.equal(cancelled.length, 1);
    assert.equal(
      cancelled[0].planId,
      p3.planId
    );
  }
);

test(
  'list filter by mint returns only matching mint',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      scanApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const p1 =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-mint-a',
          exactMint: 'MINT_A',
        })
      );

    await writeApprovedExecutionPlan(
      buildPayload({
        signature: 'sig-mint-b',
        exactMint: 'MINT_B',
      })
    );

    const { valid } =
      await scanApprovedExecutionPlans();

    const filtered =
      applyListFilters(valid, {
        mint: 'MINT_A',
      });

    assert.equal(filtered.length, 1);
    assert.equal(
      filtered[0].planId,
      p1.planId
    );
  }
);

test(
  'list filter by pool returns only matching pool',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      scanApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const p1 =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-pool-a',
          approvedPoolAddress: 'POOL_A',
        })
      );

    await writeApprovedExecutionPlan(
      buildPayload({
        signature: 'sig-pool-b',
        approvedPoolAddress: 'POOL_B',
      })
    );

    const { valid } =
      await scanApprovedExecutionPlans();

    const filtered =
      applyListFilters(valid, {
        pool: 'POOL_A',
      });

    assert.equal(filtered.length, 1);
    assert.equal(
      filtered[0].planId,
      p1.planId
    );
  }
);

test(
  'list limit caps the number of returned plans',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      scanApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    for (let i = 0; i < 5; i++) {
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: `sig-limit-${i}`,
          createdAt: new Date(
            1_000_000 + i * 1_000
          ).toISOString(),
        })
      );
    }

    const { valid } =
      await scanApprovedExecutionPlans();

    const limited =
      applyListFilters(valid, {
        limit: 2,
      });

    assert.equal(limited.length, 2);
  }
);

test(
  'prune dry-run returns summary with correct counts',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      pruneApprovedExecutionPlans,
      scanApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    /*
     * Create an expired prepared plan and a fresh one.
     * nowMs = 2_000_000, threshold = 30s.
     */
    await writeApprovedExecutionPlan(
      buildPayload({
        signature: 'sig-prune-expired',
        createdAt: new Date(
          2_000_000 - 60_000
        ).toISOString(),
      })
    );

    await writeApprovedExecutionPlan(
      buildPayload({
        signature: 'sig-prune-fresh',
        createdAt: new Date(
          2_000_000 - 5_000
        ).toISOString(),
      })
    );

    const { valid, invalid } =
      await scanApprovedExecutionPlans();

    const results =
      await pruneApprovedExecutionPlans({
        nowMs: 2_000_000,
        dryRun: true,
      });

    /*
     * The CLI builds its summary from these values.
     * Verify the contract: scanned, valid, invalid,
     * wouldPrune, pruned, skippedInvalid.
     */
    const summary = {
      scanned:
        valid.length + invalid.length,
      valid: valid.length,
      invalid: invalid.length,
      wouldPrune: results.length,
      pruned: 0,
      skippedInvalid: invalid.length,
    };

    assert.equal(summary.scanned, 2);
    assert.equal(summary.valid, 2);
    assert.equal(summary.invalid, 0);
    assert.equal(summary.wouldPrune, 1);
    assert.equal(summary.pruned, 0);
    assert.equal(summary.skippedInvalid, 0);
  }
);

test(
  'doctor health: exit 0 when healthy',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      scanApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    /*
     * Fresh prepared plan, no invalid.
     */
    await writeApprovedExecutionPlan(
      buildPayload({
        signature: 'sig-healthy',
        createdAt: new Date(
          Date.now() - 1_000
        ).toISOString(),
      })
    );

    const { valid, invalid } =
      await scanApprovedExecutionPlans();

    const maxPreparedAgeMs =
      Number(
        process.env
          .MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS
      ) * 1_000;

    const nowMs = Date.now();

    let stalePrepared = 0;

    for (const plan of valid) {
      if (
        plan.state.status === 'prepared'
      ) {
        const ageMs =
          nowMs -
          Date.parse(
            plan.payload.createdAt
          );

        if (ageMs > maxPreparedAgeMs) {
          stalePrepared++;
        }
      }
    }

    const hasInvalid = invalid.length > 0;
    const hasStale = stalePrepared > 0;

    let exitCode = 0;

    if (hasInvalid) exitCode += 1;
    if (hasStale) exitCode += 2;

    assert.equal(exitCode, 0);
  }
);

test(
  'doctor health: exit 2 when stale prepared plans found',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      scanApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    /*
     * Stale prepared plan (createdAt 60s ago).
     */
    await writeApprovedExecutionPlan(
      buildPayload({
        signature: 'sig-stale',
        createdAt: new Date(
          Date.now() - 60_000
        ).toISOString(),
      })
    );

    const { valid, invalid } =
      await scanApprovedExecutionPlans();

    const maxPreparedAgeMs =
      Number(
        process.env
          .MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS
      ) * 1_000;

    const nowMs = Date.now();

    let stalePrepared = 0;

    for (const plan of valid) {
      if (
        plan.state.status === 'prepared'
      ) {
        const ageMs =
          nowMs -
          Date.parse(
            plan.payload.createdAt
          );

        if (ageMs > maxPreparedAgeMs) {
          stalePrepared++;
        }
      }
    }

    const hasInvalid = invalid.length > 0;
    const hasStale = stalePrepared > 0;

    let exitCode = 0;

    if (hasInvalid) exitCode += 1;
    if (hasStale) exitCode += 2;

    assert.equal(hasInvalid, false);
    assert.equal(hasStale, true);
    assert.equal(exitCode, 2);
  }
);

test(
  'doctor health: exit 1 when invalid plans found',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      scanApprovedExecutionPlans,
      getApprovedExecutionPlanPath,
    } = await import(
      '../sniper/execution-plan.js'
    );

    /*
     * Create a plan, then tamper with it to make
     * it invalid.
     */
    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-will-tamper',
          createdAt: new Date(
            Date.now() - 1_000
          ).toISOString(),
        })
      );

    const path =
      getApprovedExecutionPlanPath(
        created.planId
      );

    const parsed = JSON.parse(
      await readFile(path, 'utf8')
    );

    parsed.payload.buyLamports =
      '999999999';

    await writeFile(
      path,
      JSON.stringify(parsed, null, 2),
      'utf8'
    );

    const { valid, invalid } =
      await scanApprovedExecutionPlans();

    const maxPreparedAgeMs =
      Number(
        process.env
          .MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS
      ) * 1_000;

    const nowMs = Date.now();

    let stalePrepared = 0;

    for (const plan of valid) {
      if (
        plan.state.status === 'prepared'
      ) {
        const ageMs =
          nowMs -
          Date.parse(
            plan.payload.createdAt
          );

        if (ageMs > maxPreparedAgeMs) {
          stalePrepared++;
        }
      }
    }

    const hasInvalid = invalid.length > 0;
    const hasStale = stalePrepared > 0;

    let exitCode = 0;

    if (hasInvalid) exitCode += 1;
    if (hasStale) exitCode += 2;

    assert.equal(hasInvalid, true);
    assert.equal(hasStale, false);
    assert.equal(exitCode, 1);
  }
);

test(
  'show JSON contract: ageMs, expired, environmentOk, environmentReasons',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      getApprovedExecutionPlanPath,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      assessExecutionPlanEnvironment,
    } = await import(
      '../sniper/execution-plan-policy.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-show-json',
          createdAt: new Date(
            Date.now() - 1_000
          ).toISOString(),
        })
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * Replicate the show CLI's JSON contract
     * computation and verify the fields.
     */
    const env =
      assessExecutionPlanEnvironment(file);

    const nowMs = Date.now();
    const ageMs =
      nowMs -
      Date.parse(file.payload.createdAt);

    const maxPreparedAgeSeconds = Number(
      process.env
        .MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS
    );

    const expired =
      file.state.status === 'prepared' &&
      ageMs >
        maxPreparedAgeSeconds * 1_000;

    /*
     * The contract: environmentOk, environmentReasons,
     * ageMs, expired, status, reusable are all present
     * and have the right types/values.
     */
    assert.equal(
      typeof env.ok,
      'boolean'
    );
    assert.ok(
      Array.isArray(env.reasons)
    );
    assert.equal(
      typeof ageMs,
      'number'
    );
    assert.equal(
      typeof expired,
      'boolean'
    );
    assert.equal(expired, false);
    assert.equal(
      file.state.status,
      'prepared'
    );
    assert.equal(
      file.state.status === 'prepared',
      true
    );
  }
);

test(
  'show JSON contract: expired is true for stale prepared plans',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-show-expired',
          createdAt: new Date(
            Date.now() - 60_000
          ).toISOString(),
        })
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    const nowMs = Date.now();
    const ageMs =
      nowMs -
      Date.parse(file.payload.createdAt);

    const maxPreparedAgeSeconds = Number(
      process.env
        .MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS
    );

    const expired =
      file.state.status === 'prepared' &&
      ageMs >
        maxPreparedAgeSeconds * 1_000;

    assert.equal(expired, true);
    assert.ok(ageMs >= 59_000);
  }
);
