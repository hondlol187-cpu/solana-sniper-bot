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

  const [
    executionPlanModule,
    auditModule,
  ] = await Promise.all([
    import('./execution-plan.js'),
    import('./audit.js'),
  ]);

  /*
   * Arg parsing:
   *   npm run sniper:prune-approved-plans
   *   npm run sniper:prune-approved-plans -- --also-prune-finished-hours 24
   *
   * --dry-run: list what would be pruned without deleting
   * --also-prune-finished-hours N: also prune simulated/cancelled
   *   plans whose transition timestamp is older than N hours.
   *   (Default: off — only expired prepared plans are pruned.)
   */
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

  if (dryRun) {
    const plans =
      await executionPlanModule
        .listApprovedExecutionPlans();

    console.log(
      `Dry run: ${plans.length} plan${plans.length === 1 ? '' : 's'} on disk.`
    );

    /*
     * Replicate the prune decision logic for reporting
     * without actually deleting. We call pruneApprovedExecutionPlans
     * with a no-op delete override... but since the helper owns
     * deletion, we instead just report what's there and what
     * thresholds apply, then exit.
     */
    console.log(
      `Prepared plans older than ${process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS ?? '30'}s will be pruned (reason: expired).`
    );

    if (
      alsoPruneFinishedAfterMs !==
      undefined
    ) {
      console.log(
        `Simulated/cancelled plans older than ${finishedHours}h will be pruned (reason: finished).`
      );
    } else {
      console.log(
        'Simulated/cancelled plans will NOT be pruned (--also-prune-finished-hours not set).'
      );
    }

    return;
  }

  const results =
    await executionPlanModule
      .pruneApprovedExecutionPlans({
        alsoPruneFinishedAfterMs,
      });

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

    return;
  }

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
