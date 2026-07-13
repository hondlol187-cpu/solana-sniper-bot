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
  let oldSimulated = 0;
  let oldCancelled = 0;
  let freshPrepared = 0;
  let freshSimulated = 0;
  let freshCancelled = 0;

  for (const plan of valid) {
    const status = plan.state.status;

    if (status === 'prepared') {
      const ageMs =
        nowMs -
        Date.parse(
          plan.payload.createdAt
        );

      if (ageMs > maxPreparedAgeMs) {
        stalePrepared++;
      } else {
        freshPrepared++;
      }
    } else if (status === 'simulated') {
      oldSimulated++;
      freshSimulated++;
    } else if (status === 'cancelled') {
      oldCancelled++;
      freshCancelled++;
    }
  }

  /*
   * "old finished" counts are not age-gated here
   * because prune only touches them when the caller
   * opts in with a threshold. The doctor reports
   * total finished counts so operators can decide.
   */
  void freshSimulated;
  void freshCancelled;
  void oldSimulated;
  void oldCancelled;

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          totalFiles:
            valid.length +
            invalid.length,
          validCount: valid.length,
          invalidCount:
            invalid.length,
          byStatus: {
            prepared:
              valid.filter(
                (p) =>
                  p.state.status ===
                  'prepared'
              ).length,
            simulated:
              valid.filter(
                (p) =>
                  p.state.status ===
                  'simulated'
              ).length,
            cancelled:
              valid.filter(
                (p) =>
                  p.state.status ===
                  'cancelled'
              ).length,
          },
          stalePreparedCount:
            stalePrepared,
          finishedCount:
            valid.filter(
              (p) =>
                p.state.status ===
                  'simulated' ||
                p.state.status ===
                  'cancelled'
            ).length,
          invalid,
          thresholds: {
            maxPreparedAgeSeconds,
          },
        },
        null,
        2
      )
    );

    return;
  }

  console.log(
    '=== APPROVED PLAN DOCTOR ==='
  );

  console.log(
    [
      `\nTotal files: ${valid.length + invalid.length}`,
      `Valid: ${valid.length}`,
      `Invalid: ${invalid.length}`,
    ].join('\n')
  );

  console.log(
    [
      '\n--- Valid by status ---',
      `Prepared: ${valid.filter((p) => p.state.status === 'prepared').length}`,
      `  (stale, would expire: ${stalePrepared})`,
      `Simulated: ${valid.filter((p) => p.state.status === 'simulated').length}`,
      `Cancelled: ${valid.filter((p) => p.state.status === 'cancelled').length}`,
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
