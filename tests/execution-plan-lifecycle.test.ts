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
    join(tmpdir(), 'sniper-plan-lifecycle-')
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

function buildPayload() {
  return {
    signature: 'sig-life-1',
    exactMint: 'BASE_1',
    createdAt: new Date(1_000_000).toISOString(),
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
  'new plans start in prepared state',
  async () => {
    await configureEnvironment();

    const {
      writeApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const plan =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    assert.equal(
      plan.state.status,
      'prepared'
    );
    assert.equal(
      plan.state.simulationCount,
      0
    );
  }
);

test(
  'tampering with state causes hash mismatch on reload',
  async () => {
    await configureEnvironment();

    const {
      writeApprovedExecutionPlan,
      getApprovedExecutionPlanPath,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const path =
      getApprovedExecutionPlanPath(
        created.planId
      );

    const parsed = JSON.parse(
      await readFile(path, 'utf8')
    );

    parsed.state.status =
      'simulated';

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
