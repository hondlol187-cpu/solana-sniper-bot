export {};

async function main(): Promise<void> {
  const [
    signature,
    exactMint,
  ] = process.argv.slice(2);

  if (!signature || !exactMint) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:prepare-approved -- <signature> <exact-mint>',
      ].join('\n')
    );
  }

  process.env.OUTPUT_MINT =
    exactMint;

  process.env.LIVE_TRADING =
    'false';

  const [
    candidateStore,
    monitorModule,
    decoderModule,
    validatorModule,
    gateModule,
    routePolicyModule,
    approvedPolicyModule,
    executionPlanModule,
    jupiterModule,
    rpcModule,
    configModule,
    auditModule,
  ] = await Promise.all([
    import('./candidate-store.js'),
    import('./monitor.js'),
    import('./raydium-decoder.js'),
    import('./pool-validator.js'),
    import('./candidate-gate.js'),
    import('./route-policy.js'),
    import('./approved-candidate-policy.js'),
    import('./execution-plan.js'),
    import('./jupiter.js'),
    import('./rpc.js'),
    import('./config.js'),
    import('./audit.js'),
  ]);

  const candidate =
    await candidateStore.getCandidate(
      signature
    );

  if (!candidate) {
    throw new Error(
      'Approved candidate was not found'
    );
  }

  if (
    candidate.status !== 'approved'
  ) {
    throw new Error(
      `Candidate must be approved; current status is ${candidate.status}`
    );
  }

  if (
    candidate.baseMint !== exactMint
  ) {
    throw new Error(
      [
        'Exact mint confirmation failed.',
        `Candidate mint: ${candidate.baseMint}.`,
        `Provided mint: ${exactMint}.`,
      ].join(' ')
    );
  }

  if (!candidate.approval) {
    throw new Error(
      'Approved candidate is missing approval snapshot'
    );
  }

  const rpcPool =
    new rpcModule.RpcPool();

  await rpcPool.initialize();
  await rpcPool.ensureCurrentHealthy();

  const signal: import('./monitor.js').RaydiumPoolSignal = {
    signature:
      candidate.signature,
    slot:
      candidate.pool.slot,
    programId:
      monitorModule
        .RAYDIUM_AMM_V4
        .toBase58(),
    detectedAt:
      new Date().toISOString(),
    validated: false,
  };

  const decoded =
    await decoderModule
      .decodeRaydiumInitialize2(
        rpcPool.current(),
        signal
      );

  const revalidated =
    await validatorModule
      .validateDecodedRaydiumPool(
        rpcPool.current(),
        decoded
      );

  const accepted =
    await gateModule
      .acceptPoolForTrading(
        revalidated
      );

  if (
    accepted.poolAddress !==
      candidate.poolAddress ||
    accepted.baseMint !==
      candidate.baseMint
  ) {
    throw new Error(
      'Fresh pool validation does not match the approved candidate'
    );
  }

  const buyLamports = BigInt(
    Math.floor(
      configModule.config
        .buyAmountSol *
        1_000_000_000
    )
  );

  const quote =
    await jupiterModule.getQuote(
      jupiterModule.SOL_MINT,
      exactMint,
      buyLamports
    );

  const routeAssessment =
    routePolicyModule
      .assessQuoteAgainstApprovedPool(
        quote,
        {
          approvedPoolAddress:
            accepted.poolAddress,
          expectedBaseMint:
            accepted.baseMint,
          expectedQuoteMint:
            accepted.quoteMint,
        }
      );

  const approvalAssessment =
    approvedPolicyModule
      .assessApprovedCandidateExecution(
        candidate,
        accepted,
        quote
      );

  const plan =
    await executionPlanModule
      .writeApprovedExecutionPlan({
        signature,
        exactMint,
        createdAt:
          new Date().toISOString(),
        quoteReceivedAtMs:
          quote.receivedAtMs,

        approvedPoolAddress:
          candidate.approval
            .approvedPoolAddress,
        approvedQuoteMint:
          candidate.approval
            .approvedQuoteMint,
        approvedLiquiditySol:
          candidate.approval
            .approvedLiquiditySol,

        currentPoolAddress:
          accepted.poolAddress,
        currentQuoteMint:
          accepted.quoteMint,
        currentLiquiditySol:
          accepted.liquiditySol,

        routeHopCount:
          routeAssessment.hopCount,
        routeLabels:
          routeAssessment.labels,
        routeAmmKeys:
          routeAssessment.ammKeys,

        quoteInputMint:
          quote.inputMint,
        quoteOutputMint:
          quote.outputMint,
        quoteInAmount:
          quote.inAmount,
        quoteOutAmount:
          quote.outAmount,
        quoteOtherAmountThreshold:
          quote.otherAmountThreshold,
        quoteSlippageBps:
          quote.slippageBps,
        quotePriceImpactPct:
          quote.priceImpactPct,
        quoteRoutePlan:
          quote.routePlan,

        routeOk:
          routeAssessment.ok,
        routeReasons:
          routeAssessment.reasons,

        approvalOk:
          approvalAssessment.ok,
        approvalReasons:
          approvalAssessment.reasons,
        quoteAgeMs:
          approvalAssessment.quoteAgeMs,
        liquidityDropPct:
          approvalAssessment.liquidityDropPct,
      });

  await auditModule.audit(
    'candidate.execution.plan-created',
    {
      signature,
      exactMint,
      approvedPoolAddress:
        accepted.poolAddress,
      routeOk:
        routeAssessment.ok,
      routeReasons:
        routeAssessment.reasons,
      approvalOk:
        approvalAssessment.ok,
      approvalReasons:
        approvalAssessment.reasons,
      quoteAgeMs:
        approvalAssessment.quoteAgeMs,
      liquidityDropPct:
        approvalAssessment.liquidityDropPct,
      planSha256:
        plan.sha256,
      planFile:
        configModule.config
          .approvedExecutionPlanFile,
    }
  );

  console.log(
    [
      'APPROVED EXECUTION PLAN CREATED',
      `Signature: ${signature}`,
      `Mint: ${exactMint}`,
      `Pool: ${accepted.poolAddress}`,
      `RouteOK: ${routeAssessment.ok}`,
      `ApprovalOK: ${approvalAssessment.ok}`,
      `QuoteAgeMs: ${approvalAssessment.quoteAgeMs}`,
      `LiquidityDropPct: ${approvalAssessment.liquidityDropPct ?? '[n/a]'}`,
      `PlanSha256: ${plan.sha256}`,
      `PlanFile: ${configModule.config.approvedExecutionPlanFile}`,
    ].join(' | ')
  );

  if (!routeAssessment.ok) {
    throw new Error(
      [
        'Quote route does not bind to the approved pool.',
        ...routeAssessment.reasons,
      ].join(' ')
    );
  }

  if (!approvalAssessment.ok) {
    throw new Error(
      [
        'Approved candidate policy checks failed.',
        ...approvalAssessment.reasons,
      ].join(' ')
    );
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `Prepare approved execution failed: ${message}`
  );

  process.exitCode = 1;
});
