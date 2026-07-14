export {};

import {
  PublicKey,
} from '@solana/web3.js';

async function main(): Promise<void> {
  process.env.LIVE_TRADING =
    'false';

  const [planId] =
    process.argv.slice(2);

  if (!planId) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:simulate-approved-plan -- <PLAN_ID>',
      ].join('\n')
    );
  }

  const [
    executionPlanModule,
    executionPlanPolicyModule,
    jupiterModule,
    rpcModule,
    planAuditModule,
    artifactRpcModule,
  ] = await Promise.all([
    import('./execution-plan.js'),
    import('./execution-plan-policy.js'),
    import('./jupiter.js'),
    import('./rpc.js'),
    import('./plan-audit.js'),
    import('./simulation-artifact-rpc.js'),
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

  if (
    planFile.state.status !==
    'prepared'
  ) {
    throw new Error(
      [
        'Approved execution plan is not reusable.',
        `Status: ${planFile.state.status}.`,
      ].join(' ')
    );
  }

  const payload =
    planFile.payload;

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
    swapMode:
      'ExactIn' as const,
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

  const connection =
    rpcPool.current();

  const artifactRpc =
    new artifactRpcModule
      .ConnectionSimulationArtifactRpc(
        connection
      );

  const builtSwap =
    await jupiterModule
      .buildSwapTransaction(
        quote,
        new PublicKey(
          payload.walletPublicKey
        )
      );

  /*
   * Returns the exact serialized bytes and the
   * raw simulation evidence. It does not broadcast.
   */
  const artifact =
    await jupiterModule
      .simulateBuiltSwapArtifact(
        connection,
        builtSwap
      );

  /*
   * This is now the only prepared -> simulated
   * transition used by the CLI.
   */
  const updatedPlan =
    await executionPlanModule
      .commitSimulationArtifact(
        {
          planId:
            planFile.planId,

          planSha256BeforeSimulation:
            planFile.sha256,

          serializedTransaction:
            artifact
              .serializedTransaction,

          simulationResponse:
            artifact
              .simulationResponse,

          rpcEndpoint:
            rpcPool.currentLabel(),

          simulatedAt:
            artifact.simulatedAt,

          recentBlockhash:
            artifact.recentBlockhash,

          lastValidBlockHeight:
            artifact
              .lastValidBlockHeight,
        },
        artifactRpc
      );

  /*
   * Audit only after the artifact has been
   * successfully committed.
   */
  await planAuditModule
    .auditPlanSimulated(
      updatedPlan,
      planFile.state.status,
      {
        environmentOk:
          environmentAssessment.ok,

        environmentReasons:
          environmentAssessment
            .reasons,

        result: 'DRY_RUN',

        contextSlot:
          artifact
            .simulationResponse
            .contextSlot,

        verifiedAtSlot:
          updatedPlan.state
            .simulationReceipt
            ?.verifiedAtSlot,

        verifiedAtBlockHeight:
          updatedPlan.state
            .simulationReceipt
            ?.verifiedAtBlockHeight,

        addressLookupTablesSha256:
          updatedPlan.state
            .simulationReceipt
            ?.addressLookupTablesSha256,

        simulatedSpendLamports:
          artifact
            .simulatedSpendLamports
            .toString(),

        serializedTransactionSha256:
          updatedPlan.state
            .simulationReceipt
            ?.serializedTransactionSha256,

        transactionMessageSha256:
          updatedPlan.state
            .simulationReceipt
            ?.transactionMessageSha256,
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
      `ContextSlot: ${artifact.simulationResponse.contextSlot}`,
      `CurrentSlot: ${artifact.currentSlot}`,
      `Result: DRY_RUN`,
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
