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

  const jsonMode = args.includes(
    '--json'
  );

  const allowInvalid = args.includes(
    '--allow-invalid'
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
    planAuditModule,
  ] = await Promise.all([
    import('./execution-plan.js'),
    import('./plan-audit.js'),
  ]);

  /*
   * Always scan so we can surface invalid files the
   * prune would have skipped and build the summary.
   */
  const { valid, invalid } =
    await executionPlanModule
      .scanApprovedExecutionPlans();

  const scanned =
    valid.length + invalid.length;

  const results =
    await executionPlanModule
      .pruneApprovedExecutionPlans({
        alsoPruneFinishedAfterMs,
        dryRun,
      });

  /*
   * Audit each pruned plan in live mode only.
   */
  if (!dryRun) {
    for (const result of results) {
      await planAuditModule.auditPlanPruned(
        result.planId,
        result.previousStatus,
        result.reason,
        result.ageMs
      );
    }
  }

  const summary = {
    scanned,
    valid: valid.length,
    invalid: invalid.length,
    wouldPrune: dryRun
      ? results.length
      : 0,
    pruned: dryRun
      ? 0
      : results.length,
    skippedInvalid:
      invalid.length,
  };

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          dryRun,
          summary,
          results,
          invalid,
        },
        null,
        2
      )
    );
  } else {
    if (dryRun) {
      console.log(
        `Dry run — would prune ${results.length} plan${results.length === 1 ? '' : 's'}:`
      );
    } else if (results.length === 0) {
      console.log(
        'No plans pruned.'
      );
    } else {
      console.log(
        `PRUNED ${results.length} plan${results.length === 1 ? '' : 's'}`
      );
    }

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

    if (dryRun) {
      console.log(
        `\nNo files were deleted (dry run).`
      );
    }

    console.log(
      `\n--- Summary ---`
    );
    console.log(
      `Scanned: ${summary.scanned}`
    );
    console.log(
      `Valid: ${summary.valid}`
    );
    console.log(
      `Invalid: ${summary.invalid}`
    );
    console.log(
      dryRun
        ? `WouldPrune: ${summary.wouldPrune}`
        : `Pruned: ${summary.pruned}`
    );
    console.log(
      `SkippedInvalid: ${summary.skippedInvalid}`
    );
  }

  /*
   * Exit non-zero if there are invalid plans and the
   * caller didn't opt in with --allow-invalid. This
   * makes prune usable in CI/cron where invalid files
   * should be a signal, not a silent skip.
   */
  if (
    invalid.length > 0 &&
    !allowInvalid
  ) {
    process.exitCode = 1;
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
