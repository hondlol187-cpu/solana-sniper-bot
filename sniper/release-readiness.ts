export {};

async function main():
  Promise<void> {
  const [jsonFlag] =
    process.argv.slice(2);

  if (
    jsonFlag !== undefined &&
    jsonFlag !== '--json'
  ) {
    throw new Error(
      'Usage: npm run sniper:release-readiness -- [--json]'
    );
  }

  const [
    configModule,
    planModule,
    journalModule,
    settlementModule,
    rpcModule,
    riskModule,
  ] = await Promise.all([
    import('./config.js'),

    import(
      './execution-plan.js'
    ),

    import(
      './execution-journal.js'
    ),

    import(
      './execution-settlement.js'
    ),

    import('./rpc.js'),

    import('./risk.js'),
  ]);

  const errors: string[] =
    [];

  const warnings: string[] =
    [];

  const {
    config,
  } = configModule;

  if (
    config.liveTrading &&
    !config.keypair
  ) {
    errors.push(
      'Live trading is enabled without a signer'
    );
  }

  if (
    config.liveTrading &&
    config.privateKeySource !==
      'file'
  ) {
    errors.push(
      'Live trading signer is not loaded from PRIVATE_KEY_FILE'
    );
  }

  if (
    config.expectedCluster ===
      'mainnet-beta' &&
    config.liveTrading &&
    !config.enableMainnetExecution
  ) {
    errors.push(
      'Mainnet live trading is enabled without ENABLE_MAINNET_EXECUTION'
    );
  }

  const planScan =
    await planModule
      .scanApprovedExecutionPlans();

  if (
    planScan.invalid.length >
    0
  ) {
    errors.push(
      `${planScan.invalid.length} invalid approved plan files`
    );
  }

  const [
    journals,
    settlements,
  ] = await Promise.all([
    journalModule
      .listExecutionJournals(),

    settlementModule
      .listExecutionSettlements(),
  ]);

  for (
    const journal of
    journals
  ) {
    if (
      journal.status ===
        'signing'
    ) {
      warnings.push(
        `Execution ${journal.executionId} is still signing`
      );
    }

    if (
      journal.status ===
        'broadcasting' ||
      journal.status ===
        'submitted'
    ) {
      errors.push(
        `Execution ${journal.executionId} requires reconciliation`
      );
    }
  }

  for (
    const settlement of
    settlements
  ) {
    if (
      settlement.status !==
      'committed'
    ) {
      errors.push(
        `Settlement ${settlement.settlementId} requires recovery`
      );
    }
  }

  const rpcPool =
    new rpcModule.RpcPool();

  try {
    await rpcPool.initialize();

    await rpcPool
      .ensureCurrentHealthy();

    const balance =
      BigInt(
        await rpcPool
          .current()
          .getBalance(
            config.walletPublicKey,
            'confirmed'
          )
      );

    const risk =
      await riskModule
        .getRiskState(
          balance
        );

    if (
      risk.haltedReason
    ) {
      errors.push(
        `Risk circuit breaker is halted: ${risk.haltedReason}`
      );
    }

    if (
      risk.reservations.length >
      0
    ) {
      errors.push(
        `${risk.reservations.length} unresolved risk reservations`
      );
    }

    if (
      balance <
      BigInt(
        config
          .minimumFeeReserveLamports
      )
    ) {
      errors.push(
        'Wallet balance is below minimum fee reserve'
      );
    }
  } catch (error) {
    errors.push(
      `RPC/risk readiness failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
  }

  const report = {
    ready:
      errors.length === 0,

    mode:
      config.liveTrading
        ? 'live'
        : 'dry-run',

    cluster:
      config.expectedCluster,

    validPlanCount:
      planScan.valid.length,

    invalidPlanCount:
      planScan.invalid.length,

    journalCount:
      journals.length,

    settlementCount:
      settlements.length,

    errors,
    warnings,
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
        report.ready
          ? 'RELEASE READY'
          : 'RELEASE NOT READY',

        `Mode: ${report.mode}`,

        `Cluster: ${report.cluster}`,

        `Errors: ${errors.length}`,

        `Warnings: ${warnings.length}`,
      ].join(' | ')
    );

    for (
      const error of
      errors
    ) {
      console.error(
        `ERROR: ${error}`
      );
    }

    for (
      const warning of
      warnings
    ) {
      console.warn(
        `WARNING: ${warning}`
      );
    }
  }

  process.exitCode =
    report.ready
      ? 0
      : 1;
}

main().catch(
  (error: unknown) => {
    console.error(
      `Release readiness failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 2;
  }
);
