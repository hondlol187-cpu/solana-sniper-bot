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

  process.env.REQUIRE_SINGLE_HOP_CANDIDATE_ROUTE =
    'true';
}

test(
  'accepts a single-hop Raydium route with matching ammKey',
  async () => {
    configureEnvironment();

    const {
      assessQuoteAgainstApprovedPool,
    } = await import(
      '../sniper/route-policy.js'
    );

    const {
      SOL_MINT,
    } = await import(
      '../sniper/jupiter.js'
    );

    const result =
      assessQuoteAgainstApprovedPool(
        {
          inputMint: SOL_MINT,
          outputMint: 'BASE_MINT',
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
                label:
                  'Raydium AMM',
                ammKey:
                  'POOL_1',
                inputMint:
                  SOL_MINT,
                outputMint:
                  'BASE_MINT',
              },
            },
          ],
          receivedAtMs:
            Date.now(),
        },
        {
          approvedPoolAddress:
            'POOL_1',
          expectedBaseMint:
            'BASE_MINT',
          expectedQuoteMint:
            SOL_MINT,
        }
      );

    assert.equal(result.ok, true);
    assert.deepEqual(
      result.reasons,
      []
    );
  }
);

test(
  'rejects multi-hop route when single-hop is required',
  async () => {
    configureEnvironment();

    const {
      assessQuoteAgainstApprovedPool,
    } = await import(
      '../sniper/route-policy.js'
    );

    const {
      SOL_MINT,
    } = await import(
      '../sniper/jupiter.js'
    );

    const result =
      assessQuoteAgainstApprovedPool(
        {
          inputMint: SOL_MINT,
          outputMint: 'BASE_MINT',
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
                label:
                  'Raydium AMM',
                ammKey:
                  'POOL_1',
                inputMint:
                  SOL_MINT,
                outputMint:
                  'INTERMEDIATE',
              },
            },
            {
              swapInfo: {
                label:
                  'Raydium CLMM',
                ammKey:
                  'POOL_2',
                inputMint:
                  'INTERMEDIATE',
                outputMint:
                  'BASE_MINT',
              },
            },
          ],
          receivedAtMs:
            Date.now(),
        },
        {
          approvedPoolAddress:
            'POOL_1',
          expectedBaseMint:
            'BASE_MINT',
          expectedQuoteMint:
            SOL_MINT,
        }
      );

    assert.equal(result.ok, false);
    assert.match(
      result.reasons.join(' '),
      /single-hop/
    );
  }
);

test(
  'rejects route without ammKey',
  async () => {
    configureEnvironment();

    const {
      assessQuoteAgainstApprovedPool,
    } = await import(
      '../sniper/route-policy.js'
    );

    const {
      SOL_MINT,
    } = await import(
      '../sniper/jupiter.js'
    );

    const result =
      assessQuoteAgainstApprovedPool(
        {
          inputMint: SOL_MINT,
          outputMint: 'BASE_MINT',
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
                label:
                  'Raydium AMM',
                inputMint:
                  SOL_MINT,
                outputMint:
                  'BASE_MINT',
              },
            },
          ],
          receivedAtMs:
            Date.now(),
        },
        {
          approvedPoolAddress:
            'POOL_1',
          expectedBaseMint:
            'BASE_MINT',
          expectedQuoteMint:
            SOL_MINT,
        }
      );

    assert.equal(result.ok, false);
    assert.match(
      result.reasons.join(' '),
      /ammKey/
    );
  }
);

test(
  'rejects route with wrong pool ammKey',
  async () => {
    configureEnvironment();

    const {
      assessQuoteAgainstApprovedPool,
    } = await import(
      '../sniper/route-policy.js'
    );

    const {
      SOL_MINT,
    } = await import(
      '../sniper/jupiter.js'
    );

    const result =
      assessQuoteAgainstApprovedPool(
        {
          inputMint: SOL_MINT,
          outputMint: 'BASE_MINT',
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
                label:
                  'Raydium AMM',
                ammKey:
                  'OTHER_POOL',
                inputMint:
                  SOL_MINT,
                outputMint:
                  'BASE_MINT',
              },
            },
          ],
          receivedAtMs:
            Date.now(),
        },
        {
          approvedPoolAddress:
            'POOL_1',
          expectedBaseMint:
            'BASE_MINT',
          expectedQuoteMint:
            SOL_MINT,
        }
      );

    assert.equal(result.ok, false);
    assert.match(
      result.reasons.join(' '),
      /matches approved pool/
    );
  }
);
