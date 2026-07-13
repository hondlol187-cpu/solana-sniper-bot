export {};

async function main(): Promise<void> {
  process.env.LIVE_TRADING =
    'false';

  const args =
    process.argv.slice(2);

  const jsonMode = args.includes(
    '--json'
  );

  const [
    executionPlanModule,
  ] = await Promise.all([
    import('./execution-plan.js'),
  ]);

  const { valid, invalid } =
    await executionPlanModule
      .scanApprovedExecutionPlans();

  /*
   * Compute the same thresholds prune uses so the
   * doctor report aligns with what prune would do.
   */
  const maxPreparedAgeSeconds =
    Number(
      process.env
        .MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS ??
        '30'
    );

  const maxPreparedAgeMs =
    maxPreparedAgeSeconds * 1_000;

  const nowMs = Date.now();

  let stalePrepared = 0;

  for (const plan of valid) {
    if (
      plan.state.status === 'prepared'
    ) {
      const ageMs =
        nowMs -
        Date.parse(
          plan.payload.createdAt
        );

      if (ageMs > maxPreparedAgeMs) {
        stalePrepared++;
      }
    }
  }

  /*
   * Health exit codes for CI/cron:
   *   0 = healthy (no invalid, no stale prepared)
   *   1 = invalid plans found
   *   2 = stale prepared plans found
   *   3 = both invalid and stale prepared
   */
  const hasInvalid =
    invalid.length > 0;
  const hasStale = stalePrepared > 0;

  let exitCode = 0;

  if (hasInvalid) exitCode += 1;
  if (hasStale) exitCode += 2;

  const report = {
    totalFiles:
      valid.length + invalid.length,
    validCount: valid.length,
    invalidCount: invalid.length,
    byStatus: {
      prepared: valid.filter(
        (p) =>
          p.state.status === 'prepared'
      ).length,
      simulated: valid.filter(
        (p) =>
          p.state.status === 'simulated'
      ).length,
      cancelled: valid.filter(
        (p) =>
          p.state.status === 'cancelled'
      ).length,
    },
    stalePreparedCount: stalePrepared,
    finishedCount: valid.filter(
      (p) =>
        p.state.status === 'simulated' ||
        p.state.status === 'cancelled'
    ).length,
    invalid,
    thresholds: {
      maxPreparedAgeSeconds,
    },
    health: {
      exitCode,
      healthy: exitCode === 0,
      hasInvalid,
      hasStale,
    },
  };

  if (jsonMode) {
    console.log(
      JSON.stringify(report, null, 2)
    );
  } else {
    console.log(
      '=== APPROVED PLAN DOCTOR ==='
    );

    console.log(
      [
        `\nTotal files: ${report.totalFiles}`,
        `Valid: ${report.validCount}`,
        `Invalid: ${report.invalidCount}`,
      ].join('\n')
    );

    console.log(
      [
        '\n--- Valid by status ---',
        `Prepared: ${report.byStatus.prepared}`,
        `  (stale, would expire: ${stalePrepared})`,
        `Simulated: ${report.byStatus.simulated}`,
        `Cancelled: ${report.byStatus.cancelled}`,
      ].join('\n')
    );

    console.log(
      [
        '\n--- Thresholds ---',
        `Max prepared age: ${maxPreparedAgeSeconds}s`,
        `Finished pruning: opt-in via --also-prune-finished-hours (off by default)`,
      ].join('\n')
    );

    if (invalid.length > 0) {
      console.log(
        `\n--- Invalid plans (${invalid.length}) ---`
      );

      for (const inv of invalid) {
        console.log(
          `  ${inv.planId} | error: ${inv.error}`
        );
      }
    }

    console.log(
      [
        '\n--- Health ---',
        `ExitCode: ${exitCode}`,
        `Healthy: ${exitCode === 0}`,
        `HasInvalid: ${hasInvalid}`,
        `HasStale: ${hasStale}`,
      ].join('\n')
    );

    if (stalePrepared > 0) {
      console.log(
        `\nAction: ${stalePrepared} prepared plan${stalePrepared === 1 ? ' is' : 's are'} stale and would be pruned by:`
      );
      console.log(
        '  npm run sniper:prune-approved-plans'
      );
    }

    if (invalid.length > 0) {
      console.log(
        `\nAction: ${invalid.length} invalid plan${invalid.length === 1 ? '' : 's'} need investigation — load failed.`
      );
    }
  }

  if (exitCode !== 0) {
    process.exitCode = exitCode;
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `Doctor approved plans failed: ${message}`
  );

  process.exitCode = 1;
});
