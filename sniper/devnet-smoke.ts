export {};

import {
  join,
} from 'node:path';

async function main():
  Promise<void> {
  const [
    planIdFlag,
    planId,
    jsonFlag,
  ] = process.argv.slice(2);

  if (
    planIdFlag !== '--plan-id' ||
    !planId
  ) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:devnet-smoke -- ',
        '--plan-id <PLAN_ID> [--json]',
      ].join('')
    );
  }

  if (
    jsonFlag !== undefined &&
    jsonFlag !== '--json'
  ) {
    throw new Error(
      'Only --json is supported'
    );
  }

  const { config } = await import(
    './config.js'
  );

  if (
    config.expectedCluster !==
      'devnet'
  ) {
    throw new Error(
      'Devnet smoke test requires EXPECTED_CLUSTER=devnet'
    );
  }

  if (
    config.liveTrading
  ) {
    throw new Error(
      'Devnet smoke test requires LIVE_TRADING=false (set LIVE_TRADING=true only with --live flag)'
    );
  }

  if (
    config.enableMainnetExecution
  ) {
    throw new Error(
      'Devnet smoke test requires ENABLE_MAINNET_EXECUTION=false'
    );
  }

  const steps: Array<{
    name: string;
    ok: boolean;
    detail?: string;
  }> = [];

  /*
   * Step 1: Load and verify the plan.
   */
  try {
    const { loadApprovedExecutionPlan } = await import(
      './execution-plan.js'
    );

    const plan = await loadApprovedExecutionPlan(planId);

    if (
      plan.state.status !== 'simulated'
    ) {
      throw new Error(
        `Plan status is ${plan.state.status}, expected simulated`
      );
    }

    if (
      !plan.state.simulationReceipt
    ) {
      throw new Error(
        'Plan has no simulation receipt'
      );
    }

    steps.push({
      name: 'load-plan',
      ok: true,
      detail: `status=${plan.state.status}`,
    });
  } catch (error) {
    steps.push({
      name: 'load-plan',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  /*
   * Step 2: Preview the verified execution (offline).
   */
  try {
    const { spawnSync } = await import('node:child_process');

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        'sniper/preview-verified-execution.ts',
        planId,
        '--json',
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
      }
    );

    if (result.status !== 0) {
      throw new Error(
        `Preview exited ${result.status}: ${result.stderr.slice(0, 200)}`
      );
    }

    steps.push({
      name: 'preview-execution',
      ok: true,
      detail: 'preview verified hashes and fee payer',
    });
  } catch (error) {
    steps.push({
      name: 'preview-execution',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  /*
   * Step 3: Verify the simulation artifact.
   */
  try {
    const { spawnSync } = await import('node:child_process');

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        'sniper/verify-simulation-artifact.ts',
        planId,
        '--json',
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
      }
    );

    if (result.status !== 0) {
      throw new Error(
        `Artifact verification exited ${result.status}: ${result.stderr.slice(0, 200)}`
      );
    }

    steps.push({
      name: 'verify-artifact',
      ok: true,
      detail: 'artifact verified',
    });
  } catch (error) {
    steps.push({
      name: 'verify-artifact',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  /*
   * Step 4: Verify execution history.
   */
  try {
    const { spawnSync } = await import('node:child_process');

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        'sniper/execution-history.ts',
        planId,
        '--json',
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
      }
    );

    if (result.status !== 0) {
      throw new Error(
        `Execution history exited ${result.status}: ${result.stderr.slice(0, 200)}`
      );
    }

    steps.push({
      name: 'execution-history',
      ok: true,
      detail: 'history retrieved',
    });
  } catch (error) {
    steps.push({
      name: 'execution-history',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  /*
   * Step 5: Check release readiness.
   */
  try {
    const { spawnSync } = await import('node:child_process');

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        'sniper/release-readiness.ts',
        '--json',
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
      }
    );

    /*
     * Release readiness may report errors (e.g. RPC failure
     * in test environments). We record the result but don't
     * fail the smoke test on readiness alone.
     */
    steps.push({
      name: 'release-readiness',
      ok: result.status === 0,
      detail: result.status === 0
        ? 'ready'
        : 'not ready (expected in offline test)',
    });
  } catch (error) {
    steps.push({
      name: 'release-readiness',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  /*
   * Step 6: Verify execution archives.
   */
  try {
    const { spawnSync } = await import('node:child_process');

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        'sniper/verify-execution-archives.ts',
        '--json',
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
      }
    );

    steps.push({
      name: 'verify-archives',
      ok: result.status === 0,
      detail: result.status === 0
        ? 'archives valid'
        : 'archive issues found',
    });
  } catch (error) {
    steps.push({
      name: 'verify-archives',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const allOk = steps.every((s) => s.ok);

  const report = {
    planId,
    cluster: config.expectedCluster,
    allOk,
    steps,
  };

  if (jsonFlag === '--json') {
    console.log(
      JSON.stringify(
        report,
        null,
        2
      )
    );
  } else {
    console.log(
      [
        allOk
          ? 'DEVNET SMOKE TEST PASSED'
          : 'DEVNET SMOKE TEST FAILED',
        `PlanId: ${planId}`,
        `Steps: ${steps.length}`,
        `Passed: ${steps.filter((s) => s.ok).length}`,
        `Failed: ${steps.filter((s) => !s.ok).length}`,
      ].join(' | ')
    );

    for (const step of steps) {
      console.log(
        `  ${step.ok ? 'PASS' : 'FAIL'} ${step.name}: ${step.detail ?? ''}`
      );
    }
  }

  process.exitCode = allOk ? 0 : 1;
}

main().catch(
  (error: unknown) => {
    console.error(
      `Devnet smoke test failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 2;
  }
);
