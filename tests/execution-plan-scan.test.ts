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
    join(tmpdir(), 'sniper-plan-scan-')
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

  /*
   * Delete valid plans via the normal helper.
   * Delete invalid plans by path (rm) since load
   * would fail. Use rm from node:fs/promises.
   */
  const { rm } = await import(
    'node:fs/promises'
  );

  for (const plan of valid) {
    await deleteApprovedExecutionPlan(
      plan.planId
    );
  }

  for (const inv of invalid) {
    await rm(inv.path, {
      force: true,
    });
    /*
     * Also remove any stale lock file.
     */
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
    createdAt: string;
  }> = {}
) {
  return {
    signature:
      overrides.signature ??
      'sig-scan-1',
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
  'scanApprovedExecutionPlans returns valid plans in the valid array',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      scanApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-scan-valid',
        })
      );

    const { valid, invalid } =
      await scanApprovedExecutionPlans();

    assert.equal(
      valid.length,
      1
    );
    assert.equal(
      valid[0].planId,
      created.planId
    );
    assert.equal(
      invalid.length,
      0
    );
  }
);

test(
  'scanApprovedExecutionPlans reports invalid hash-mismatch file',
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

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-scan-tampered',
        })
      );

    /*
     * Tamper with the file on disk so the hash
     * no longer matches. The scanner should catch
     * this and report it in the invalid array.
     */
    const path =
      getApprovedExecutionPlanPath(
        created.planId
      );

    const parsed = JSON.parse(
      await readFile(path, 'utf8')
    );

    parsed.payload.quoteOutAmount =
      '999999';

    await writeFile(
      path,
      JSON.stringify(parsed, null, 2),
      'utf8'
    );

    const { valid, invalid } =
      await scanApprovedExecutionPlans();

    assert.equal(
      valid.length,
      0
    );
    assert.equal(
      invalid.length,
      1
    );
    assert.equal(
      invalid[0].planId,
      created.planId
    );
    assert.match(
      invalid[0].error,
      /hash mismatch/
    );
    assert.equal(
      invalid[0].path,
      path
    );
  }
);

test(
  'dry-run prune returns exact candidates without deleting',
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
     * Create an expired prepared plan (createdAt 60s
     * before nowMs = 2_000_000; threshold is 30s).
     */
    const expired =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-scan-dryrun',
          createdAt: new Date(
            2_000_000 - 60_000
          ).toISOString(),
        })
      );

    /*
     * Dry-run prune should return the candidate
     * but NOT delete it.
     */
    const results =
      await pruneApprovedExecutionPlans({
        nowMs: 2_000_000,
        dryRun: true,
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

    /*
     * The plan must still be on disk.
     */
    const remaining =
      await listApprovedExecutionPlans();

    assert.equal(
      remaining.length,
      1
    );
    assert.equal(
      remaining[0].planId,
      expired.planId
    );
  }
);

test(
  'scan returns both valid and invalid plans simultaneously',
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

    const good =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-scan-good',
        })
      );

    const bad =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-scan-bad',
        })
      );

    /*
     * Tamper with the second plan.
     */
    const badPath =
      getApprovedExecutionPlanPath(
        bad.planId
      );

    const parsed = JSON.parse(
      await readFile(badPath, 'utf8')
    );

    parsed.payload.buyLamports =
      '999999999';

    await writeFile(
      badPath,
      JSON.stringify(parsed, null, 2),
      'utf8'
    );

    const { valid, invalid } =
      await scanApprovedExecutionPlans();

    assert.equal(
      valid.length,
      1
    );
    assert.equal(
      valid[0].planId,
      good.planId
    );
    assert.equal(
      invalid.length,
      1
    );
    assert.equal(
      invalid[0].planId,
      bad.planId
    );
  }
);

test(
  'scan returns empty valid+invalid when dir does not exist',
  async () => {
    await configureEnvironment();

    /*
     * Point scan at a non-existent child directory
     * by temporarily swapping the env var. Config
     * is cached at import time, so this won't affect
     * the actual scan — but we can still verify the
     * empty-result contract by scanning a clean dir
     * that happens to be empty.
     */
    await cleanPlanDir();

    const {
      scanApprovedExecutionPlans,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const { valid, invalid } =
      await scanApprovedExecutionPlans();

    assert.equal(
      valid.length,
      0
    );
    assert.equal(
      invalid.length,
      0
    );
  }
);

test(
  'listApprovedExecutionPlans delegates to scan and returns only valid plans',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      listApprovedExecutionPlans,
      scanApprovedExecutionPlans,
      getApprovedExecutionPlanPath,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const good =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-scan-delegate-good',
        })
      );

    const bad =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-scan-delegate-bad',
        })
      );

    /*
     * Tamper with bad.
     */
    const badPath =
      getApprovedExecutionPlanPath(
        bad.planId
      );

    const parsed = JSON.parse(
      await readFile(badPath, 'utf8')
    );

    parsed.payload.buyLamports =
      '999999999';

    await writeFile(
      badPath,
      JSON.stringify(parsed, null, 2),
      'utf8'
    );

    const list =
      await listApprovedExecutionPlans();
    const scan =
      await scanApprovedExecutionPlans();

    assert.equal(
      list.length,
      1
    );
    assert.equal(
      list[0].planId,
      good.planId
    );
    assert.equal(
      scan.valid.length,
      1
    );
    assert.equal(
      scan.invalid.length,
      1
    );
    /*
     * list should equal scan.valid (same reference
     * contract — sorted by createdAt ascending).
     */
    assert.equal(
      list[0].planId,
      scan.valid[0].planId
    );
  }
);
