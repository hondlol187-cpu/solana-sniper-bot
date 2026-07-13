export {};

async function main(): Promise<void> {
  process.env.LIVE_TRADING =
    'false';

  const args =
    process.argv.slice(2);

  const jsonMode = args.includes(
    '--json'
  );

  const positionalArgs =
    args.filter(
      (arg) => !arg.startsWith('--')
    );

  const [planId] = positionalArgs;

  if (!planId) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:show-approved-plan -- <plan-id> [--json]',
      ].join('\n')
    );
  }

  const [
    executionPlanModule,
    executionPlanPolicyModule,
  ] = await Promise.all([
    import('./execution-plan.js'),
    import('./execution-plan-policy.js'),
  ]);

  /*
   * Try to load the plan. If load fails (corrupt, tampered,
   * missing, hash mismatch), surface the explicit error rather
   * than a generic stack trace.
   */
  let file;

  try {
    file =
      await executionPlanModule
        .loadApprovedExecutionPlan(
          planId
        );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    if (jsonMode) {
      console.log(
        JSON.stringify(
          {
            planId,
            valid: false,
            error: message,
          },
          null,
          2
        )
      );
    } else {
      console.error(
        `Approved execution plan is invalid: ${message}`
      );
    }

    process.exitCode = 1;

    return;
  }

  const path =
    executionPlanModule
      .getApprovedExecutionPlanPath(
        file.planId
      );

  const environmentAssessment =
    executionPlanPolicyModule
      .assessExecutionPlanEnvironment(
        file
      );

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          planId: file.planId,
          valid: true,
          version: file.version,
          diskVersion:
            file.diskVersion,
          sha256: file.sha256,
          path,
          state: file.state,
          payload: file.payload,
          environment: {
            ok: environmentAssessment.ok,
            reasons:
              environmentAssessment.reasons,
          },
        },
        null,
        2
      )
    );

    return;
  }

  const state = file.state;
  const payload = file.payload;

  console.log(
    '=== APPROVED EXECUTION PLAN ==='
  );

  console.log(
    [
      '\n--- Header ---',
      `PlanId: ${file.planId}`,
      `Version: ${file.version}`,
      `DiskVersion: ${file.diskVersion}`,
      `Sha256: ${file.sha256}`,
      `Path: ${path}`,
    ].join('\n')
  );

  console.log(
    [
      '\n--- State ---',
      `Status: ${state.status}`,
      `SimulationCount: ${state.simulationCount}`,
      `CreatedAt: ${state.createdAt}`,
      `SimulatedAt: ${state.simulatedAt ?? '-'}`,
      `CancelledAt: ${state.cancelledAt ?? '-'}`,
      `LastSimulationResult: ${state.lastSimulationResult ?? '-'}`,
      `CancellationReason: ${state.cancellationReason ?? '-'}`,
    ].join('\n')
  );

  console.log(
    [
      '\n--- Environment Binding ---',
      `WalletPublicKey: ${payload.walletPublicKey}`,
      `ExpectedCluster: ${payload.expectedCluster}`,
      `BuyLamports: ${payload.buyLamports}`,
      `EnvironmentOK: ${environmentAssessment.ok}`,
      ...(environmentAssessment.ok
        ? []
        : [
            `EnvironmentReasons: ${environmentAssessment.reasons.join('; ')}`,
          ]),
    ].join('\n')
  );

  console.log(
    [
      '\n--- Route Assessment ---',
      `RouteOK: ${payload.routeOk}`,
      `RouteHopCount: ${payload.routeHopCount}`,
      `RouteLabels: ${payload.routeLabels.join(', ') || '-'}`,
      `RouteAmmKeys: ${payload.routeAmmKeys.join(', ') || '-'}`,
      ...(payload.routeOk
        ? []
        : [
            `RouteReasons: ${payload.routeReasons.join('; ')}`,
          ]),
    ].join('\n')
  );

  console.log(
    [
      '\n--- Approval Assessment ---',
      `ApprovalOK: ${payload.approvalOk}`,
      `QuoteAgeMs: ${payload.quoteAgeMs}`,
      `LiquidityDropPct: ${payload.liquidityDropPct ?? '[n/a]'}`,
      ...(payload.approvalOk
        ? []
        : [
            `ApprovalReasons: ${payload.approvalReasons.join('; ')}`,
          ]),
    ].join('\n')
  );

  console.log(
    [
      '\n--- Approved Pool Snapshot ---',
      `ApprovedPoolAddress: ${payload.approvedPoolAddress}`,
      `ApprovedQuoteMint: ${payload.approvedQuoteMint}`,
      `ApprovedLiquiditySol: ${payload.approvedLiquiditySol}`,
    ].join('\n')
  );

  console.log(
    [
      '\n--- Current Pool Snapshot ---',
      `CurrentPoolAddress: ${payload.currentPoolAddress}`,
      `CurrentQuoteMint: ${payload.currentQuoteMint}`,
      `CurrentLiquiditySol: ${payload.currentLiquiditySol}`,
    ].join('\n')
  );

  console.log(
    [
      '\n--- Quote ---',
      `Signature: ${payload.signature}`,
      `ExactMint: ${payload.exactMint}`,
      `CreatedAt: ${payload.createdAt}`,
      `QuoteReceivedAtMs: ${payload.quoteReceivedAtMs}`,
      `QuoteInputMint: ${payload.quoteInputMint}`,
      `QuoteOutputMint: ${payload.quoteOutputMint}`,
      `QuoteInAmount: ${payload.quoteInAmount}`,
      `QuoteOutAmount: ${payload.quoteOutAmount}`,
      `QuoteOtherAmountThreshold: ${payload.quoteOtherAmountThreshold}`,
      `QuoteSlippageBps: ${payload.quoteSlippageBps}`,
      `QuotePriceImpactPct: ${payload.quotePriceImpactPct}`,
    ].join('\n')
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `Show approved plan failed: ${message}`
  );

  process.exitCode = 1;
});
