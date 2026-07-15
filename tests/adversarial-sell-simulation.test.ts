import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'adversarial scenarios produce detectable evidence',
  async () => {
    const { ADVERSARIAL_SCENARIOS, createBaseSimulation, applyAdversarialScenario } = await import('../sniper/adversarial-sell-simulation.js');

    assert.ok(ADVERSARIAL_SCENARIOS.length >= 5, 'Must have at least 5 adversarial scenarios');

    for (const scenario of ADVERSARIAL_SCENARIOS) {
      const base = createBaseSimulation('Mint1111111111111111111111111111111', 100, 250000000);
      const modified = applyAdversarialScenario(base, scenario);

      assert.ok(modified, `${scenario.name} should produce a result`);
      assert.equal(typeof modified.success, 'boolean', `${scenario.name} result should have success boolean`);
    }
  }
);

test(
  'high_price_impact scenario increases price impact',
  async () => {
    const { ADVERSARIAL_SCENARIOS, createBaseSimulation, applyAdversarialScenario } = await import('../sniper/adversarial-sell-simulation.js');

    const scenario = ADVERSARIAL_SCENARIOS.find(s => s.name === 'high_price_impact')!;
    const base = createBaseSimulation('Mint1111111111111111111111111111111', 100, 250000000);
    const modified = applyAdversarialScenario(base, scenario);

    assert.ok(modified.priceImpactPct > base.priceImpactPct);
    assert.equal(modified.priceImpactPct, 95);
  }
);

test(
  'no_full_exit_route blocks 100% sell',
  async () => {
    const { ADVERSARIAL_SCENARIOS, createBaseSimulation, applyAdversarialScenario } = await import('../sniper/adversarial-sell-simulation.js');

    const scenario = ADVERSARIAL_SCENARIOS.find(s => s.name === 'no_full_exit_route')!;
    const base100 = createBaseSimulation('Mint1111111111111111111111111111111', 100, 250000000);
    const base10 = createBaseSimulation('Mint1111111111111111111111111111111', 10, 250000000);

    const modified100 = applyAdversarialScenario(base100, scenario);
    const modified10 = applyAdversarialScenario(base10, scenario);

    assert.equal(modified100.routeAvailable, false);
    assert.equal(modified100.success, false);
    assert.equal(modified10.routeAvailable, true);
  }
);

test(
  'balance_mismatch scenario sets zero balance change',
  async () => {
    const { ADVERSARIAL_SCENARIOS, createBaseSimulation, applyAdversarialScenario } = await import('../sniper/adversarial-sell-simulation.js');

    const scenario = ADVERSARIAL_SCENARIOS.find(s => s.name === 'balance_mismatch')!;
    const base = createBaseSimulation('Mint1111111111111111111111111111111', 50, 250000000);
    const modified = applyAdversarialScenario(base, scenario);

    assert.equal(modified.tokenBalanceChange, '0');
    assert.equal(modified.success, true);
  }
);

test(
  'buildSellabilityEvidence detects small-sell-only pattern',
  async () => {
    const { buildSellabilityEvidence } = await import('../sniper/sellability-evidence.js');

    const evidence = buildSellabilityEvidence({
      mintAddress: 'Mint1111111111111111111111111111111',
      planId: 'test-plan',
      simulations: [
        {
          exitSizePct: 10,
          routeAvailable: true,
          expectedOutput: '100000',
          priceImpactPct: 3,
          roundTripLossPct: 1,
          simulationSlot: 250000000,
          routeProgramIds: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLuZqi5NvAwBNu1'],
          tokenBalanceChange: '100000',
          simulationLogs: [],
          success: true,
        },
        {
          exitSizePct: 50,
          routeAvailable: false,
          expectedOutput: '0',
          priceImpactPct: 0,
          roundTripLossPct: 0,
          simulationSlot: 250000000,
          routeProgramIds: [],
          tokenBalanceChange: '0',
          simulationLogs: [],
          success: false,
          error: 'No route',
        },
        {
          exitSizePct: 100,
          routeAvailable: false,
          expectedOutput: '0',
          priceImpactPct: 0,
          roundTripLossPct: 0,
          simulationSlot: 250000000,
          routeProgramIds: [],
          tokenBalanceChange: '0',
          simulationLogs: [],
          success: false,
          error: 'No route',
        },
      ],
    });

    assert.equal(evidence.onlySmallestSellSucceeds, true);
    assert.equal(evidence.fullExitRouteFound, false);
  }
);

test(
  'unapproved_route_program scenario uses unknown program',
  async () => {
    const { ADVERSARIAL_SCENARIOS, createBaseSimulation, applyAdversarialScenario } = await import('../sniper/adversarial-sell-simulation.js');

    const scenario = ADVERSARIAL_SCENARIOS.find(s => s.name === 'unapproved_route_program')!;
    const base = createBaseSimulation('Mint1111111111111111111111111111111', 50, 250000000);
    const modified = applyAdversarialScenario(base, scenario);

    assert.ok(modified.routeProgramIds.includes('MaliciousDex1111111111111111111111111'));
  }
);