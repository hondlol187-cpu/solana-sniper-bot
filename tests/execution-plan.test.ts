import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

/*
 * All tests in this file share a single temp directory
 * and a single APPROVED_EXECUTION_PLAN_FILE env value.
 * This is required because sniper/config.ts captures env
 * vars at module-load time, and dynamic import() returns
 * the cached module on subsequent calls. If each test
 * pointed to a different temp path, the cached config
 * would still reference the first test's path.
 */
let configured = false;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-plan-test-')
  );

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';
  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_FILE =
    join(dir, 'approved-plan.json');
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS =
    '30';

  configured = true;
}

function buildPayload() {
  return {
    signature: 'sig-1',
    exactMint: 'BASE_1',
    createdAt: new Date(1_000_000).toISOString(),
    quoteReceivedAtMs: 995_000,

    walletPublicKey:
      '11111111111111111111111111111111',
    expectedCluster:
      'mainnet-beta',
    buyLamports:
      '10000000',

    approvedPoolAddress: 'POOL_1',
    approvedQuoteMint:
      'So11111111111111111111111111111111111111112',
    approvedLiquiditySol: 100,

    currentPoolAddress: 'POOL_1',
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
    quoteRoutePlan: [
      {
        swapInfo: {
          label: 'Raydium AMM',
          ammKey: 'POOL_1',
        },
      },
    ],

    routeOk: true,
    routeReasons: [],
    approvalOk: true,
    approvalReasons: [],
    quoteAgeMs: 5_000,
    liquidityDropPct: 10,
  };
}

test(
  'writes and reloads a valid plan',
  async () => {
    await configureEnvironment();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const payload =
      buildPayload();

    const written =
      await writeApprovedExecutionPlan(
        payload
      );

    const loaded =
      await loadApprovedExecutionPlan();

    assert.equal(
      loaded.version,
      1
    );
    assert.deepEqual(
      loaded.payload,
      written.payload
    );
    assert.equal(
      loaded.sha256,
      written.sha256
    );
  }
);

test(
  'rejects tampered plan file',
  async () => {
    await configureEnvironment();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const payload =
      buildPayload();

    await writeApprovedExecutionPlan(
      payload
    );

    const path =
      process.env
        .APPROVED_EXECUTION_PLAN_FILE!;

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

    await assert.rejects(
      () =>
        loadApprovedExecutionPlan(),
      /hash mismatch/
    );
  }
);

test(
  'rejects stale plan age',
  async () => {
    await configureEnvironment();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      validateApprovedExecutionPlanAge,
    } = await import(
      '../sniper/execution-plan.js'
    );

    await writeApprovedExecutionPlan(
      buildPayload()
    );

    const file =
      await loadApprovedExecutionPlan();

    assert.throws(
      () =>
        validateApprovedExecutionPlanAge(
          file,
          1_000_000 + 31_000
        ),
      /too old/
    );
  }
);
