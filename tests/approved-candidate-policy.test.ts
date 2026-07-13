import assert from 'node:assert/strict';
import test from 'node:test';

function configureEnvironment(): void {
  process.env.LIVE_TRADING =
    'false';

  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';

  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';

  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';

  process.env.CANDIDATE_EXECUTION_QUOTE_MAX_AGE_SECONDS =
    '10';

  process.env.MAX_APPROVED_LIQUIDITY_DROP_PCT =
    '50';
}

function buildCandidate() {
  return {
    signature: 'sig-1',
    poolAddress: 'POOL_1',
    baseMint: 'BASE_1',
    status: 'approved',
    pool: {
      signature: 'sig-1',
      slot: 123,
      poolAddress: 'POOL_1',
      baseMint: 'BASE_1',
      quoteMint: 'So11111111111111111111111111111111111111112',
      liquiditySol: 100,
      openTime: 1,
    },
    firstSeenAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    approval: {
      approvedAt: new Date().toISOString(),
      confirmedMint: 'BASE_1',
      approvedPoolAddress: 'POOL_1',
      approvedQuoteMint: 'So11111111111111111111111111111111111111112',
      approvedLiquiditySol: 100,
    },
  };
}

function buildPool(liquiditySol: number) {
  return {
    signature: 'sig-1',
    slot: 123,
    poolAddress: 'POOL_1',
    baseMint: 'BASE_1',
    quoteMint: 'So11111111111111111111111111111111111111112',
    liquiditySol,
    openTime: 1,
  };
}

function buildQuote(receivedAtMs: number) {
  return {
    inputMint:
      'So11111111111111111111111111111111111111112',
    outputMint: 'BASE_1',
    inAmount: '10000000',
    outAmount: '123456',
    otherAmountThreshold:
      '120000',
    swapMode: 'ExactIn',
    slippageBps: 150,
    priceImpactPct: '0.5',
    routePlan: [
      {
        swapInfo: {
          label: 'Raydium AMM',
          ammKey: 'POOL_1',
          inputMint:
            'So11111111111111111111111111111111111111112',
          outputMint: 'BASE_1',
        },
      },
    ],
    receivedAtMs,
  };
}

test(
  'accepts fresh quote and acceptable liquidity drift',
  async () => {
    configureEnvironment();

    const {
      assessApprovedCandidateExecution,
    } = await import(
      '../sniper/approved-candidate-policy.js'
    );

    const nowMs = 1_000_000;
    const result =
      assessApprovedCandidateExecution(
        buildCandidate() as any,
        buildPool(80) as any,
        buildQuote(nowMs - 5_000) as any,
        nowMs
      );

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.reasons,
      []
    );
    assert.equal(
      result.quoteAgeMs,
      5_000
    );
    assert.equal(
      result.liquidityDropPct,
      20
    );
  }
);

test(
  'rejects stale quote',
  async () => {
    configureEnvironment();

    const {
      assessApprovedCandidateExecution,
    } = await import(
      '../sniper/approved-candidate-policy.js'
    );

    const nowMs = 1_000_000;
    const result =
      assessApprovedCandidateExecution(
        buildCandidate() as any,
        buildPool(100) as any,
        buildQuote(nowMs - 11_000) as any,
        nowMs
      );

    assert.equal(result.ok, false);
    assert.match(
      result.reasons.join(' '),
      /too old/
    );
  }
);

test(
  'rejects pool-address drift from approval snapshot',
  async () => {
    configureEnvironment();

    const {
      assessApprovedCandidateExecution,
    } = await import(
      '../sniper/approved-candidate-policy.js'
    );

    const candidate =
      buildCandidate();

    const revalidatedPool = {
      ...buildPool(100),
      poolAddress: 'POOL_2',
    };

    const result =
      assessApprovedCandidateExecution(
        candidate as any,
        revalidatedPool as any,
        buildQuote(995_000) as any,
        1_000_000
      );

    assert.equal(result.ok, false);
    assert.match(
      result.reasons.join(' '),
      /pool address/
    );
  }
);

test(
  'rejects excessive liquidity drop since approval',
  async () => {
    configureEnvironment();

    const {
      assessApprovedCandidateExecution,
    } = await import(
      '../sniper/approved-candidate-policy.js'
    );

    const result =
      assessApprovedCandidateExecution(
        buildCandidate() as any,
        buildPool(40) as any,
        buildQuote(995_000) as any,
        1_000_000
      );

    assert.equal(result.ok, false);
    assert.match(
      result.reasons.join(' '),
      /liquidity dropped too far/
    );
    assert.equal(
      result.liquidityDropPct,
      60
    );
  }
);
