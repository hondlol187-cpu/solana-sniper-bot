// sniper/adversarial-sell-simulation.ts
import type { SellabilitySimulationResult } from './sellability-evidence.js';
import type { SellabilityEvidence } from './sellability-evidence.js';

export interface AdversarialScenario {
  name: string;
  description: string;
  apply: (simulation: SellabilitySimulationResult) => SellabilitySimulationResult;
}

/**
 * Predefined adversarial scenarios that simulate
 * deceptive or malicious token behaviors.
 */
export const ADVERSARIAL_SCENARIOS: AdversarialScenario[] = [
  {
    name: 'high_price_impact',
    description: 'Token with extreme price impact on exit, suggesting low liquidity or manipulation',
    apply: (sim) => ({
      ...sim,
      priceImpactPct: 95,
      expectedOutput: '100',
      success: true,
    }),
  },
  {
    name: 'no_full_exit_route',
    description: 'Full 100% sell fails but partial sells succeed — classic honeypot pattern',
    apply: (sim) => {
      if (sim.exitSizePct === 100) {
        return { ...sim, routeAvailable: false, success: false, error: 'No route found' };
      }
      return sim;
    },
  },
  {
    name: 'transfer_fee_drain',
    description: 'Token with excessive transfer fees that drain most of the output',
    apply: (sim) => ({
      ...sim,
      roundTripLossPct: 90,
      tokenBalanceChange: '50',
      success: true,
    }),
  },
  {
    name: 'balance_mismatch',
    description: 'Simulation reports success but token balance does not change — deceptive simulation',
    apply: (sim) => ({
      ...sim,
      tokenBalanceChange: '0',
      success: true,
    }),
  },
  {
    name: 'unapproved_route_program',
    description: 'Route goes through an unapproved program — potential malicious DEX',
    apply: (sim) => ({
      ...sim,
      routeProgramIds: ['MaliciousDex1111111111111111111111111'],
      success: true,
    }),
  },
  {
    name: 'malformed_output',
    description: 'Simulation returns zero output despite claiming success',
    apply: (sim) => ({
      ...sim,
      expectedOutput: '0',
      success: true,
      routeAvailable: true,
    }),
  },
];

export function createBaseSimulation(
  mintAddress: string,
  exitSizePct: number,
  slot: number
): SellabilitySimulationResult {
  return {
    exitSizePct,
    routeAvailable: true,
    expectedOutput: String(1_000_000 * (exitSizePct / 100)),
    priceImpactPct: exitSizePct * 0.3,
    roundTripLossPct: exitSizePct * 0.1,
    simulationSlot: slot,
    routeProgramIds: ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLuZqi5NvAwBNu1'],
    tokenBalanceChange: String(1_000_000 * (exitSizePct / 100)),
    simulationLogs: [`Simulated ${exitSizePct}% exit`],
    success: true,
  };
}

export function applyAdversarialScenario(
  base: SellabilitySimulationResult,
  scenario: AdversarialScenario
): SellabilitySimulationResult {
  return scenario.apply({ ...base });
}

export function runAdversarialMatrix(
  mintAddress: string,
  planId: string,
  baseSlot: number,
  scenarios: AdversarialScenario[] = ADVERSARIAL_SCENARIOS
): { scenario: string; evidence: SellabilityEvidence; simulationCount: number }[] {
  const exitSizes = [10, 50, 100];
  const results: { scenario: string; evidence: SellabilityEvidence; simulationCount: number }[] = [];

  for (const scenario of scenarios) {
    const simulations: SellabilitySimulationResult[] = [];

    for (const exitSize of exitSizes) {
      const base = createBaseSimulation(mintAddress, exitSize, baseSlot);
      const modified = applyAdversarialScenario(base, scenario);
      simulations.push(modified);
    }

    const { buildSellabilityEvidence } = require('./sellability-evidence.js') as typeof import('./sellability-evidence.js');
    const evidence = buildSellabilityEvidence({
      mintAddress,
      planId: `${planId}:${scenario.name}`,
      simulations,
    });

    results.push({
      scenario: scenario.name,
      evidence,
      simulationCount: simulations.length,
    });
  }

  return results;
}