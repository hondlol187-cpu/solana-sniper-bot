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
    join(tmpdir(), 'sniper-plan-migration-')
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
    createdAt: string;
  }> = {}
) {
  return {
    signature:
      overrides.signature ??
      'sig-migrate-1',
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

/**
 * Manually write a v1 plan file to disk, simulating a
 * legacy file written before the version-2 bump.
 *
 * v1 state shape has no `cancelledAt` field.
 */
async function writeLegacyV1Plan(
  payload: ReturnType<typeof buildPayload>
): Promise<string> {
  const {
    getApprovedExecutionPlanPath,
  } = await import(
    '../sniper/execution-plan.js'
  );

  const {
    createHash,
  } = await import('node:crypto');

  /*
   * buildPlanId is not exported, so we replicate it here.
   * Must match the implementation in execution-plan.ts.
   */
  const shortHash = createHash('sha256')
    .update(
      [
        payload.signature,
        payload.exactMint,
        payload.createdAt,
        payload.walletPublicKey,
      ].join('|')
    )
    .digest('hex')
    .slice(0, 16);

  const planId = [
    payload.signature.slice(0, 12),
    payload.exactMint.slice(0, 12),
    shortHash,
  ].join('_');

  /*
   * v1 state: no cancelledAt field.
   */
  const v1State = {
    status: 'prepared' as const,
    simulationCount: 0,
    createdAt: payload.createdAt,
  };

  const v1FileContent = {
    version: 1 as const,
    planId,
    state: v1State,
    payload,
  };

  /*
   * Compute the v1 hash. stableStringify sorts keys
   * alphabetically, so we need to match that behavior.
   */
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

  const sha256 = createHash('sha256')
    .update(stableStringify(v1FileContent))
    .digest('hex');

  const v1File = {
    ...v1FileContent,
    sha256,
  };

  const path =
    getApprovedExecutionPlanPath(planId);

  /*
   * Ensure the directory exists before writing.
   */
  const { mkdir } = await import(
    'node:fs/promises'
  );

  await mkdir(
    join(path, '..'),
    {
      recursive: true,
      mode: 0o700,
    }
  );

  await writeFile(
    path,
    JSON.stringify(v1File, null, 2),
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );

  return planId;
}

test(
  'new writes produce version 2 files',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const written =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-v2-new',
        })
      );

    assert.equal(
      written.version,
      2
    );

    const loaded =
      await loadApprovedExecutionPlan(
        written.planId
      );

    assert.equal(
      loaded.version,
      2
    );
  }
);

test(
  'loads legacy v1 plan successfully',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const planId =
      await writeLegacyV1Plan(
        buildPayload({
          signature: 'sig-v1-legacy',
        })
      );

    const loaded =
      await loadApprovedExecutionPlan(
        planId
      );

    assert.equal(
      loaded.version,
      1
    );
    assert.equal(
      loaded.state.status,
      'prepared'
    );
    assert.equal(
      loaded.state.simulationCount,
      0
    );
    assert.equal(
      loaded.state.cancelledAt,
      undefined
    );
  }
);

test(
  'migrates v1 to v2',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      migrateApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const planId =
      await writeLegacyV1Plan(
        buildPayload({
          signature: 'sig-v1-migrate',
        })
      );

    /*
     * Verify it's v1 before migration.
     */
    const before =
      await loadApprovedExecutionPlan(
        planId
      );

    assert.equal(before.version, 1);

    /*
     * Migrate.
     */
    const migrated =
      await migrateApprovedExecutionPlan(
        planId
      );

    assert.equal(
      migrated.version,
      2
    );
    assert.notEqual(
      migrated.sha256,
      before.sha256
    );

    /*
     * Verify the on-disk file is now v2.
     */
    const after =
      await loadApprovedExecutionPlan(
        planId
      );

    assert.equal(after.version, 2);
    assert.equal(
      after.sha256,
      migrated.sha256
    );
  }
);

test(
  'migrating an already-v2 plan is a no-op',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      migrateApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-v2-noop',
        })
      );

    const migrated =
      await migrateApprovedExecutionPlan(
        created.planId
      );

    assert.equal(
      migrated.version,
      2
    );
    assert.equal(
      migrated.sha256,
      created.sha256
    );
  }
);

test(
  'migrated plan reloads cleanly and preserves state',
  async () => {
    await configureEnvironment();
    await cleanPlanDir();

    const {
      writeApprovedExecutionPlan,
      markApprovedExecutionPlanSimulated,
      migrateApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    /*
     * Write a v2 plan, simulate it, then manually
     * rewrite it as v1 on disk to simulate a legacy
     * file that was simulated before the v2 bump.
     */
    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          signature: 'sig-v1-simulated',
        })
      );

    await markApprovedExecutionPlanSimulated(
      created.planId,
      'sim-ok'
    );

    /*
     * Read the current v2 file, rewrite it as v1
     * (drop cancelledAt from state, change version
     * to 1, recompute v1 hash).
     */
    const {
      getApprovedExecutionPlanPath,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const {
      createHash,
    } = await import('node:crypto');

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

    const path =
      getApprovedExecutionPlanPath(
        created.planId
      );

    const parsed = JSON.parse(
      await readFile(path, 'utf8')
    );

    /*
     * Strip cancelledAt and lastSimulationResult
     * to make it a pure v1 shape (v1 state doesn't
     * have cancelledAt; lastSimulationResult is
     * present in both but let's keep it).
     */
    delete parsed.state.cancelledAt;
    parsed.version = 1;

    const v1Content = {
      version: 1 as const,
      planId: parsed.planId,
      state: parsed.state,
      payload: parsed.payload,
    };

    parsed.sha256 = createHash('sha256')
      .update(stableStringify(v1Content))
      .digest('hex');

    await writeFile(
      path,
      JSON.stringify(parsed, null, 2),
      'utf8'
    );

    /*
     * Verify the v1 file loads.
     */
    const v1Loaded =
      await loadApprovedExecutionPlan(
        created.planId
      );

    assert.equal(v1Loaded.version, 1);
    assert.equal(
      v1Loaded.state.status,
      'simulated'
    );

    /*
     * Migrate and verify state is preserved.
     */
    const migrated =
      await migrateApprovedExecutionPlan(
        created.planId
      );

    assert.equal(migrated.version, 2);
    assert.equal(
      migrated.state.status,
      'simulated'
    );
    assert.equal(
      migrated.state.simulationCount,
      1
    );
    assert.equal(
      migrated.state.lastSimulationResult,
      'sim-ok'
    );

    /*
     * Reload from disk to confirm the v2 file is valid.
     */
    const reloaded =
      await loadApprovedExecutionPlan(
        created.planId
      );

    assert.equal(reloaded.version, 2);
    assert.equal(
      reloaded.sha256,
      migrated.sha256
    );
    assert.equal(
      reloaded.state.status,
      'simulated'
    );
  }
);
