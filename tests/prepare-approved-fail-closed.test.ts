import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  readdir,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;
let plansDir = '';

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-prepare-fail-closed-')
  );

  plansDir = join(dir, 'plans');

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';
  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_DIR =
    plansDir;
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS =
    '30';

  configured = true;
}

/**
 * Mirror of the contract enforced by sniper/prepare-approved.ts:
 * the fail-closed helper MUST throw before writeApprovedExecutionPlan
 * is ever called. If the helper throws, no plan file may land on disk.
 *
 * This inline function lets the test exercise that contract without
 * needing to spin up RPC + Jupiter + candidate-store fixtures.
 */
async function tryPreparePlan(
  routeAssessment: {
    ok: boolean;
    reasons: string[];
    hopCount: number;
    labels: string[];
    ammKeys: string[];
  },
  approvalAssessment: {
    ok: boolean;
    reasons: string[];
    quoteAgeMs: number;
    liquidityDropPct: number | null;
  },
  payload: unknown
): Promise<void> {
  const {
    assertPlanCanBeWritten,
  } = await import(
    '../sniper/prepare-approved-core.js'
  );

  assertPlanCanBeWritten(
    routeAssessment as any,
    approvalAssessment as any
  );

  const {
    writeApprovedExecutionPlan,
  } = await import(
    '../sniper/execution-plan.js'
  );

  await writeApprovedExecutionPlan(
    payload as any
  );
}

function buildPayload() {
  return {
    signature: 'sig-fail-closed',
    exactMint: 'BASE_1',
    createdAt: new Date().toISOString(),
    quoteReceivedAtMs: Date.now() - 1_000,

    walletPublicKey:
      '11111111111111111111111111111111',
    expectedCluster: 'mainnet-beta',
    buyLamports: '10000000',

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
    quoteAgeMs: 1_000,
    liquidityDropPct: 10,
  };
}

test(
  'no plan file is created when route assessment fails',
  async () => {
    await configureEnvironment();

    const beforeFiles =
      (await readdir(plansDir).catch(
        () => [] as string[]
      )) as string[];

    await assert.rejects(
      () =>
        tryPreparePlan(
          {
            ok: false,
            reasons: ['bad route'],
            hopCount: 2,
            labels: [],
            ammKeys: [],
          },
          {
            ok: true,
            reasons: [],
            quoteAgeMs: 1000,
            liquidityDropPct: 0,
          },
          buildPayload()
        ),
      /route does not bind/
    );

    const afterFiles =
      (await readdir(plansDir).catch(
        () => [] as string[]
      )) as string[];

    assert.deepEqual(
      afterFiles,
      beforeFiles
    );
  }
);

test(
  'no plan file is created when approval assessment fails',
  async () => {
    await configureEnvironment();

    const beforeFiles =
      (await readdir(plansDir).catch(
        () => [] as string[]
      )) as string[];

    await assert.rejects(
      () =>
        tryPreparePlan(
          {
            ok: true,
            reasons: [],
            hopCount: 1,
            labels: ['Raydium'],
            ammKeys: ['POOL_1'],
          },
          {
            ok: false,
            reasons: ['quote too old'],
            quoteAgeMs: 999_999,
            liquidityDropPct: 0,
          },
          buildPayload()
        ),
      /policy checks failed/
    );

    const afterFiles =
      (await readdir(plansDir).catch(
        () => [] as string[]
      )) as string[];

    assert.deepEqual(
      afterFiles,
      beforeFiles
    );
  }
);

test(
  'plan file IS created when both assessments pass (control)',
  async () => {
    await configureEnvironment();

    const beforeFiles =
      (await readdir(plansDir).catch(
        () => [] as string[]
      )) as string[];

    await tryPreparePlan(
      {
        ok: true,
        reasons: [],
        hopCount: 1,
        labels: ['Raydium'],
        ammKeys: ['POOL_1'],
      },
      {
        ok: true,
        reasons: [],
        quoteAgeMs: 1000,
        liquidityDropPct: 0,
      },
      buildPayload()
    );

    const afterFiles =
      (await readdir(plansDir).catch(
        () => [] as string[]
      )) as string[];

    assert.equal(
      afterFiles.length,
      beforeFiles.length + 1
    );
  }
);
