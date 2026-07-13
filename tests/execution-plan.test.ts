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
    join(tmpdir(), 'sniper-plan-test-')
  );

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';
  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_DIR =
    join(dir, 'approved-plans');
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
      await loadApprovedExecutionPlan(
        written.planId
      );

    assert.equal(
      loaded.version,
      3
    );
    assert.equal(
      loaded.planId,
      written.planId
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
      getApprovedExecutionPlanPath,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const written =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const path =
      getApprovedExecutionPlanPath(
        written.planId
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

    await assert.rejects(
      () =>
        loadApprovedExecutionPlan(
          written.planId
        ),
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

    const written =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const file =
      await loadApprovedExecutionPlan(
        written.planId
      );

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

test(
  'creates unique plan ids for different timestamps',
  async () => {
    await configureEnvironment();

    const {
      writeApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const first =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const secondPayload =
      buildPayload();

    secondPayload.createdAt =
      new Date(1_000_001).toISOString();

    const second =
      await writeApprovedExecutionPlan(
        secondPayload
      );

    assert.notEqual(
      first.planId,
      second.planId
    );
  }
);
