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

  /*
   * Set OUTPUT_MINT before importing modules that
   * load config.ts.
   */
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
    rpcModule,
    configModule,
    auditModule,
  ] = await Promise.all([
    import('./candidate-store.js'),
    import('./monitor.js'),
    import('./raydium-decoder.js'),
    import('./pool-validator.js'),
    import('./candidate-gate.js'),
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

  if (
    mode === '--live' &&
    !configModule.config.liveTrading
  ) {
    throw new Error(
      [
        '--live was requested but LIVE_TRADING is not true.',
        'Live execution requires both the command flag and environment setting.',
      ].join(' ')
    );
  }

  const rpcPool =
    new rpcModule.RpcPool();

  await rpcPool.initialize();
  await rpcPool.ensureCurrentHealthy();

  /*
   * Reconstruct the original signal and rerun the
   * entire decoder and validator immediately before
   * execution.
   */
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

  await auditModule.audit(
    'candidate.execution.requested',
    {
      signature,
      exactMint,
      poolAddress:
        accepted.poolAddress,
      liquiditySol:
        accepted.liquiditySol,
      mode:
        mode === '--live'
          ? 'live'
          : 'dry-run',
    }
  );

  console.log(
    [
      'APPROVED CANDIDATE REVALIDATED',
      `Mode: ${mode}`,
      `Mint: ${accepted.baseMint}`,
      `Pool: ${accepted.poolAddress}`,
      `Liquidity: ${accepted.liquiditySol} SOL`,
    ].join(' | ')
  );

  /*
   * Import only after OUTPUT_MINT and LIVE_TRADING
   * have been finalized.
   */
  const tradingModule =
    await import('./index.js');

  await tradingModule.run();

  if (mode === '--live') {
    await candidateStore
      .markCandidateExecuted(
        signature,
        'full trade lifecycle completed'
      );

    console.log(
      'Candidate marked EXECUTED'
    );
  } else {
    await auditModule.audit(
      'candidate.execution.dry-run.completed',
      {
        signature,
        exactMint,
      }
    );

    console.log(
      [
        'DRY RUN COMPLETED',
        'Candidate remains APPROVED.',
        'No transaction was broadcast.',
      ].join(' | ')
    );
  }
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
