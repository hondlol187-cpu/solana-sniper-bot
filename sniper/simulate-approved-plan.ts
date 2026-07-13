export {};

import { PublicKey } from '@solana/web3.js';

async function main(): Promise<void> {
  process.env.LIVE_TRADING =
    'false';

  const [planId] =
    process.argv.slice(2);

  if (!planId) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:simulate-approved-plan -- <plan-id>',
      ].join('\n')
    );
  }

  const [
    executionPlanModule,
    executionPlanPolicyModule,
    jupiterModule,
    rpcModule,
    planAuditModule,
  ] = await Promise.all([
    import('./execution-plan.js'),
    import('./execution-plan-policy.js'),
    import('./jupiter.js'),
    import('./rpc.js'),
    import('./plan-audit.js'),
  ]);

  const planFile =
    await executionPlanModule
      .loadApprovedExecutionPlan(
        planId
      );

  executionPlanModule
    .validateApprovedExecutionPlanAge(
      planFile
    );

  const environmentAssessment =
    executionPlanPolicyModule
      .assessExecutionPlanEnvironment(
        planFile
      );

  if (!environmentAssessment.ok) {
    throw new Error(
      [
        'Approved execution plan environment checks failed.',
        ...environmentAssessment.reasons,
      ].join(' ')
    );
  }

  const payload =
    planFile.payload;

  // Replay protection: only plans in the `prepared` state can be
  // simulated. A plan that has already been simulated (or cancelled)
  // is single-use by default — operators must re-prepare a fresh
  // plan from the candidate store if they want to simulate again.
  if (
    planFile.state.status !== 'prepared'
  ) {
    throw new Error(
      [
        'Approved execution plan is not reusable.',
        `Status: ${planFile.state.status}.`,
      ].join(' ')
    );
  }

  if (!payload.routeOk) {
    throw new Error(
      [
        'Approved execution plan is not route-approved.',
        ...payload.routeReasons,
      ].join(' ')
    );
  }

  if (!payload.approvalOk) {
    throw new Error(
      [
        'Approved execution plan is not approval-approved.',
        ...payload.approvalReasons,
      ].join(' ')
    );
  }

  const quote = {
    inputMint:
      payload.quoteInputMint,
    outputMint:
      payload.quoteOutputMint,
    inAmount:
      payload.quoteInAmount,
    outAmount:
      payload.quoteOutAmount,
    otherAmountThreshold:
      payload.quoteOtherAmountThreshold,
    swapMode: 'ExactIn' as const,
    slippageBps:
      payload.quoteSlippageBps,
    priceImpactPct:
      payload.quotePriceImpactPct,
    routePlan:
      payload.quoteRoutePlan,
    platformFee: null,
    contextSlot: 0,
    timeTaken: 0,
    receivedAtMs:
      payload.quoteReceivedAtMs,
  };

  const rpcPool =
    new rpcModule.RpcPool();

  await rpcPool.initialize();
  await rpcPool.ensureCurrentHealthy();

  const builtSwap =
    await jupiterModule
      .buildSwapTransaction(
        quote,
        new PublicKey(
          payload.walletPublicKey
        )
      );

  const result =
    await jupiterModule
      .simulateAndSend(
        rpcPool.current(),
        null,
        builtSwap
      );

  const updatedPlan =
    await executionPlanModule
      .markApprovedExecutionPlanSimulated(
        planFile.planId,
        result
      );

  await planAuditModule.auditPlanSimulated(
    updatedPlan,
    planFile.state.status,
    {
      environmentOk:
        environmentAssessment.ok,
      environmentReasons:
        environmentAssessment.reasons,
      result,
    }
  );

  console.log(
    [
      'APPROVED PLAN SIMULATED',
      `Signature: ${payload.signature}`,
      `Mint: ${payload.exactMint}`,
      `Pool: ${payload.approvedPoolAddress}`,
      `Wallet: ${payload.walletPublicKey}`,
      `Cluster: ${payload.expectedCluster}`,
      `PlanId: ${updatedPlan.planId}`,
      `PlanSha256: ${updatedPlan.sha256}`,
      `PreviousStatus: ${planFile.state.status}`,
      `NewStatus: ${updatedPlan.state.status}`,
      `SimulationCount: ${updatedPlan.state.simulationCount}`,
      `Result: ${result}`,
      'No transaction was broadcast.',
    ].join(' | ')
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `Simulate approved plan failed: ${message}`
  );

  process.exitCode = 1;
});
