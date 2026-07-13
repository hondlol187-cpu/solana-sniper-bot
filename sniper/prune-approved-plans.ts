export {};

function parseFinishedHours(
  raw: string | undefined
): number | undefined {
  if (
    raw === undefined ||
    raw.trim() === ''
  ) {
    return undefined;
  }

  const hours = Number(raw);

  if (
    !Number.isFinite(hours) ||
    hours <= 0
  ) {
    throw new Error(
      `--also-prune-finished-hours must be a positive number, got: ${raw}`
    );
  }

  return hours;
}

async function main(): Promise<void> {
  process.env.LIVE_TRADING =
    'false';

  const args =
    process.argv.slice(2);

  const dryRun = args.includes(
    '--dry-run'
  );

  const finishedHoursIdx =
    args.indexOf(
      '--also-prune-finished-hours'
    );

  const finishedHours =
    finishedHoursIdx >= 0
      ? parseFinishedHours(
          args[finishedHoursIdx + 1]
        )
      : undefined;

  const alsoPruneFinishedAfterMs =
    finishedHours !== undefined
      ? finishedHours * 3_600_000
      : undefined;

  const [
    executionPlanModule,
    auditModule,
  ] = await Promise.all([
    import('./execution-plan.js'),
    import('./audit.js'),
  ]);

  /*
   * Always scan so we can surface invalid files the
   * prune would have skipped. In dry-run mode we do
   * NOT delete — pruneApprovedExecutionPlans returns
   * the exact candidates instead.
   */
  const { invalid } =
    await executionPlanModule
      .scanApprovedExecutionPlans();

  const results =
    await executionPlanModule
      .pruneApprovedExecutionPlans({
        alsoPruneFinishedAfterMs,
        dryRun,
      });

  if (dryRun) {
    console.log(
      `Dry run — would prune ${results.length} plan${results.length === 1 ? '' : 's'}:`
    );

    for (const result of results) {
      console.log(
        [
          `  PlanId: ${result.planId}`,
          `PreviousStatus: ${result.previousStatus}`,
          `Reason: ${result.reason}`,
          `AgeMs: ${result.ageMs}`,
        ].join(' | ')
      );
    }

    if (invalid.length > 0) {
      console.log(
        `\nSkipped ${invalid.length} invalid plan${invalid.length === 1 ? '' : 's'} (not loadable, not pruned):`
      );

      for (const inv of invalid) {
        console.log(
          `  ${inv.planId} | error: ${inv.error}`
        );
      }
    }

    console.log(
      `\nNo files were deleted (dry run).`
    );

    return;
  }

  for (const result of results) {
    await auditModule.audit(
      'candidate.execution.plan-pruned',
      {
        planId: result.planId,
        previousStatus:
          result.previousStatus,
        reason: result.reason,
        ageMs: result.ageMs,
      }
    );
  }

  if (results.length === 0) {
    console.log(
      'No plans pruned.'
    );
  } else {
    console.log(
      `PRUNED ${results.length} plan${results.length === 1 ? '' : 's'}`
    );

    for (const result of results) {
      console.log(
        [
          `  PlanId: ${result.planId}`,
          `PreviousStatus: ${result.previousStatus}`,
          `Reason: ${result.reason}`,
          `AgeMs: ${result.ageMs}`,
        ].join(' | ')
      );
    }
  }

  if (invalid.length > 0) {
    console.log(
      `\nSkipped ${invalid.length} invalid plan${invalid.length === 1 ? '' : 's'} (not loadable, not pruned):`
    );

    for (const inv of invalid) {
      console.log(
        `  ${inv.planId} | error: ${inv.error}`
      );
    }
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `Prune approved plans failed: ${message}`
  );

  process.exitCode = 1;
});
