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
    join(tmpdir(), 'sniper-plan-concurrency-')
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

  // Tighten the file-lock retry window so a second transition
  // attempt on an already-mutated plan fails fast rather than
  // waiting the default 10s.
  process.env.FILE_LOCK_TIMEOUT_MS =
    '1000';
  process.env.FILE_LOCK_RETRY_MS =
    '20';

  configured = true;
}

function buildPayload() {
  return {
    signature: 'sig-concurrency-1',
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
  'cancel rejects already cancelled plans',
  async () => {
    await configureEnvironment();

    const {
      writeApprovedExecutionPlan,
      cancelApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    await cancelApprovedExecutionPlan(
      created.planId,
      'manual cancel'
    );

    await assert.rejects(
      () =>
        cancelApprovedExecutionPlan(
          created.planId,
          'again'
        ),
      /not reusable|cancelled/
    );
  }
);

test(
  'delete removes plan file',
  async () => {
    await configureEnvironment();

    const {
      writeApprovedExecutionPlan,
      deleteApprovedExecutionPlan,
      loadApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    await deleteApprovedExecutionPlan(
      created.planId
    );

    await assert.rejects(
      () =>
        loadApprovedExecutionPlan(
          created.planId
        ),
      /ENOENT|no such file/i
    );
  }
);

