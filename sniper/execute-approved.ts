async function main(): Promise<void> {
  const [
    signature,
    exactMint,
    mode = '--dry-run',
  ] = process.argv.slice(2);

  if (!signature || !exactMint) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:execute-approved -- <signature> <exact-mint> --dry-run',
        'npm run sniper:execute-approved -- <signature> <exact-mint> --live',
      ].join('\n')
    );
  }

  if (
    mode !== '--dry-run' &&
    mode !== '--live'
  ) {
    throw new Error(
      'Mode must be --dry-run or --live'
    );
  }

  process.env.OUTPUT_MINT =
    exactMint;

  if (mode === '--dry-run') {
    process.env.LIVE_TRADING =
      'false';
  }

  const [
    candidateStore,
    monitorModule,
    decoderModule,
    validatorModule,
    gateModule,
    routePolicyModule,
    approvedPolicyModule,
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

  const assessment =
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

  await auditModule.audit(
    'candidate.execution.route-assessed',
    {
      signature,
      mode:
        mode === '--live'
          ? 'live'
          : 'dry-run',
      approvedPoolAddress:
        accepted.poolAddress,
      hopCount:
        assessment.hopCount,
      labels:
        assessment.labels,
      ammKeys:
        assessment.ammKeys,
      routeOk: assessment.ok,
      routeReasons:
        assessment.reasons,
      approvalOk:
        approvalAssessment.ok,
      approvalReasons:
        approvalAssessment.reasons,
      quoteAgeMs:
        approvalAssessment.quoteAgeMs,
      liquidityDropPct:
        approvalAssessment.liquidityDropPct,
    }
  );

  console.log(
    [
      'APPROVED CANDIDATE REVALIDATED',
      `Mode: ${mode}`,
      `Mint: ${accepted.baseMint}`,
      `Pool: ${accepted.poolAddress}`,
      `Liquidity: ${accepted.liquiditySol} SOL`,
      `RouteOK: ${assessment.ok}`,
      `ApprovalOK: ${approvalAssessment.ok}`,
      `QuoteAgeMs: ${approvalAssessment.quoteAgeMs}`,
      `LiquidityDropPct: ${approvalAssessment.liquidityDropPct ?? '[n/a]'}`,
      `RouteLabels: ${assessment.labels.join(', ') || '[none]'}`,
      `RouteAmmKeys: ${assessment.ammKeys.join(', ') || '[none]'}`,
    ].join(' | ')
  );

  if (!assessment.ok) {
    throw new Error(
      [
        'Quote route does not bind to the approved pool.',
        ...assessment.reasons,
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

  /*
   * Live approved-candidate execution is still
   * intentionally disabled. The current generic
   * trading path does not consume the attested
   * quote directly, so a later quote could differ.
   */
  if (mode === '--live') {
    throw new Error(
      [
        'Live execution of approved candidates is intentionally disabled.',
        'A future batch must add a direct pool-bound execution path that uses the attested quote and transaction inputs end-to-end.',
        'Use --dry-run for now.',
      ].join(' ')
    );
  }

  const builtSwap =
    await jupiterModule
      .buildSwapTransaction(
        quote,
        configModule.config
          .walletPublicKey
      );

  const result =
    await jupiterModule
      .simulateAndSend(
        rpcPool.current(),
        null,
        builtSwap
      );

  await auditModule.audit(
    'candidate.execution.dry-run.completed',
    {
      signature,
      exactMint,
      result,
      approvedPoolAddress:
        accepted.poolAddress,
    }
  );

  console.log(
    [
      'DRY RUN COMPLETED',
      `Result: ${result}`,
      'Candidate remains APPROVED.',
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
    `Approved execution failed: ${message}`
  );

  process.exitCode = 1;
});
