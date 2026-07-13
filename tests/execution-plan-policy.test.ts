import assert from 'node:assert/strict';
import test from 'node:test';

function configureEnvironment(): void {
  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';
  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';
  process.env.EXPECTED_CLUSTER =
    'mainnet-beta';
  process.env.BUY_AMOUNT_SOL =
    '0.01';
}

function buildPlan() {
  return {
    version: 1 as const,
    sha256: 'dummy',
    payload: {
      signature: 'sig-1',
      exactMint: 'BASE_1',
      createdAt: new Date().toISOString(),
      quoteReceivedAtMs: Date.now(),

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
      currentLiquiditySol: 95,

      routeHopCount: 1,
      routeLabels: ['Raydium AMM'],
      routeAmmKeys: ['POOL_1'],

      quoteInputMint:
        'So11111111111111111111111111111111111111112',
      quoteOutputMint: 'BASE_1',
      quoteInAmount: '10000000',
      quoteOutAmount: '123456',
      quoteOtherAmountThreshold:
        '120000',
      quoteSlippageBps: 150,
      quotePriceImpactPct: '0.5',
      quoteRoutePlan: [],

      routeOk: true,
      routeReasons: [],
      approvalOk: true,
      approvalReasons: [],
      quoteAgeMs: 1000,
      liquidityDropPct: 5,
    },
  };
}

test(
  'accepts matching execution-plan environment',
  async () => {
    configureEnvironment();

    const {
      assessExecutionPlanEnvironment,
    } = await import(
      '../sniper/execution-plan-policy.js'
    );

    const result =
      assessExecutionPlanEnvironment(
        buildPlan() as any
      );

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.reasons,
      []
    );
  }
);

test(
  'rejects wallet mismatch',
  async () => {
    configureEnvironment();

    const {
      assessExecutionPlanEnvironment,
    } = await import(
      '../sniper/execution-plan-policy.js'
    );

    const plan =
      buildPlan();

    plan.payload.walletPublicKey =
      'So11111111111111111111111111111111111111112';

    const result =
      assessExecutionPlanEnvironment(
        plan as any
      );

    assert.equal(result.ok, false);
    assert.match(
      result.reasons.join(' '),
      /wallet/
    );
  }
);

test(
  'rejects cluster mismatch',
  async () => {
    configureEnvironment();

    const {
      assessExecutionPlanEnvironment,
    } = await import(
      '../sniper/execution-plan-policy.js'
    );

    const plan =
      buildPlan();

    plan.payload.expectedCluster =
      'devnet';

    const result =
      assessExecutionPlanEnvironment(
        plan as any
      );

    assert.equal(result.ok, false);
    assert.match(
      result.reasons.join(' '),
      /cluster/
    );
  }
);

test(
  'rejects buy-amount mismatch',
  async () => {
    configureEnvironment();

    const {
      assessExecutionPlanEnvironment,
    } = await import(
      '../sniper/execution-plan-policy.js'
    );

    const plan =
      buildPlan();

    plan.payload.buyLamports =
      '20000000';

    const result =
      assessExecutionPlanEnvironment(
        plan as any
      );

    assert.equal(result.ok, false);
    assert.match(
      result.reasons.join(' '),
      /buy amount/
    );
  }
);
