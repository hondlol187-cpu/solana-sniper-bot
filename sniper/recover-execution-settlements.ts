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
      'Usage: npm run sniper:recover-execution-settlements -- [--json]'
    );
  }

  const [
    settlementModule,
    executionPlanModule,
    rpcModule,
  ] = await Promise.all([
    import(
      './execution-settlement.js'
    ),

    import(
      './execution-plan.js'
    ),

    import('./rpc.js'),
  ]);

  const rpcPool =
    new rpcModule.RpcPool();

  await rpcPool.initialize();

  await rpcPool
    .ensureCurrentHealthy();

  const settlements =
    await settlementModule
      .listExecutionSettlements();

  const results: Array<{
    settlementId: string;
    previousStatus: string;
    currentStatus: string;
    result:
      | 'recovered'
      | 'skipped'
      | 'error';
    error?: string;
  }> = [];

  for (
    const settlement of
    settlements
  ) {
    if (
      settlement.status ===
      'committed'
    ) {
      continue;
    }

    try {
      const plan =
        await executionPlanModule
          .loadApprovedExecutionPlan(
            settlement.planId
          );

      const balance =
        BigInt(
          await rpcPool
            .current()
            .getBalance(
              new (
                await import(
                  '@solana/web3.js'
                )
              ).PublicKey(
                plan.payload
                  .walletPublicKey
              ),
              'confirmed'
            )
        );

      const recovered =
        await settlementModule
          .settleExecutionOutcome({
            executionId:
              settlement
                .executionId,

            outcome:
              settlement.outcome,

            observedSlot:
              settlement
                .observedSlot,

            confirmationStatus:
              settlement
                .confirmationStatus,

            failureReason:
              settlement
                .failureReason,

            currentBalanceLamports:
              balance,
          });

      results.push({
        settlementId:
          settlement
            .settlementId,

        previousStatus:
          settlement.status,

        currentStatus:
          recovered.status,

        result: 'recovered',
      });
    } catch (error) {
      results.push({
        settlementId:
          settlement
            .settlementId,

        previousStatus:
          settlement.status,

        currentStatus:
          settlement.status,

        result: 'error',

        error:
          error instanceof Error
            ? error.message
            : String(error),
      });
    }
  }

  const report = {
    recovered:
      results.filter(
        (item) =>
          item.result ===
          'recovered'
      ).length,

    errors:
      results.filter(
        (item) =>
          item.result ===
          'error'
      ).length,

    results,
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
        'EXECUTION SETTLEMENT RECOVERY',
        `Recovered: ${report.recovered}`,
        `Errors: ${report.errors}`,
      ].join(' | ')
    );
  }

  process.exitCode =
    report.errors > 0
      ? 1
      : 0;
}

main().catch(
  (error: unknown) => {
    console.error(
      `Settlement recovery failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 2;
  }
);
