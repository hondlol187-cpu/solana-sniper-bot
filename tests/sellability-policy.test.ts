import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'fresh evidence with all sizes passing is sellable',
  async () => {
    const { evaluateSellabilityPolicy } = await import('../sniper/sellability-policy.js');

    const result = evaluateSellabilityPolicy(
      {
        version: 1,
        mintAddress: 'Mint1111111111111111111111111111111',
        planId: 'plan1',
        assessedAt: new Date().toISOString(),
        assessedSlot: 250000000,
        simulations: [],
        fullExitRouteFound: true,
        onlySmallestSellSucceeds: false,
        routeProgramIds: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLuZqi5NvAwBNu1'],
        balanceChangeMismatch: false,
      },
      250000005,
      { maxSlotLag: 20, maxAgeSeconds: 60 }
    );

    assert.equal(result.decision, 'sellable');
    assert.equal(result.reasons.length, 0);
  }
);

test(
  'stale evidence is indeterminate',
  async () => {
    const { evaluateSellabilityPolicy } = await import('../sniper/sellability-policy.js');

    const result = evaluateSellabilityPolicy(
      {
        version: 1,
        mintAddress: 'Mint2222222222222222222222222222222',
        planId: 'plan2',
        assessedAt: new Date().toISOString(),
        assessedSlot: 249999900,
        simulations: [],
        fullExitRouteFound: true,
        onlySmallestSellSucceeds: false,
        routeProgramIds: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLuZqi5NvAwBNu1'],
        balanceChangeMismatch: false,
      },
      250000000,
      { maxSlotLag: 20, maxAgeSeconds: 60 }
    );

    assert.equal(result.decision, 'indeterminate');
  }
);

test(
  'small-sell-only token is unsellable',
  async () => {
    const { evaluateSellabilityPolicy } = await import('../sniper/sellability-policy.js');

    const result = evaluateSellabilityPolicy(
      {
        version: 1,
        mintAddress: 'Mint3333333333333333333333333333333',
        planId: 'plan3',
        assessedAt: new Date().toISOString(),
        assessedSlot: 250000000,
        simulations: [],
        fullExitRouteFound: false,
        onlySmallestSellSucceeds: true,
        routeProgramIds: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLuZqi5NvAwBNu1'],
        balanceChangeMismatch: false,
      },
      250000005,
      { maxSlotLag: 20, maxAgeSeconds: 60 }
    );

    assert.equal(result.decision, 'unsellable');
    assert.ok(result.reasons.some(r => r.includes('smallest')));
  }
);

test(
  'unapproved route program is unsellable',
  async () => {
    const { evaluateSellabilityPolicy } = await import('../sniper/sellability-policy.js');

    const result = evaluateSellabilityPolicy(
      {
        version: 1,
        mintAddress: 'Mint4444444444444444444444444444444',
        planId: 'plan4',
        assessedAt: new Date().toISOString(),
        assessedSlot: 250000000,
        simulations: [],
        fullExitRouteFound: true,
        onlySmallestSellSucceeds: false,
        routeProgramIds: ['UnknownProgram111111111111111111111'],
        balanceChangeMismatch: false,
      },
      250000005,
      { maxSlotLag: 20, maxAgeSeconds: 60 }
    );

    assert.equal(result.decision, 'unsellable');
    assert.ok(result.reasons.some(r => r.includes('Unapproved')));
  }
);

test(
  'assertSellabilityEvidenceFresh rejects stale slot',
  async () => {
    const { assertSellabilityEvidenceFresh } = await import('../sniper/sellability-policy.js');

    const result = assertSellabilityEvidenceFresh({
      currentSlot: 250000100,
      evidenceSlot: 250000000,
      maximumSlotLag: 5,
    });

    assert.equal(result.fresh, false);
    assert.ok(result.reason?.includes('100 slots behind'));
  }
);

test(
  'assertSellabilityEvidenceFresh passes when fresh',
  async () => {
    const { assertSellabilityEvidenceFresh } = await import('../sniper/sellability-policy.js');

    const result = assertSellabilityEvidenceFresh({
      currentSlot: 250000003,
      evidenceSlot: 250000000,
      maximumSlotLag: 10,
    });

    assert.equal(result.fresh, true);
  }
);