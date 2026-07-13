export {};

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

  const plans =
    await executionPlanModule
      .listApprovedExecutionPlans();

  if (plans.length === 0) {
    console.log(
      'No approved execution plans found. Nothing to migrate.'
    );

    return;
  }

  let migrated = 0;
  let skipped = 0;

  for (const plan of plans) {
    /*
     * diskVersion tells us what's on disk. If it's
     * already 2, migration is a no-op.
     */
    if (plan.diskVersion === 2) {
      skipped++;

      continue;
    }

    const result =
      await executionPlanModule
        .migrateApprovedExecutionPlan(
          plan.planId
        );

    if (!result.migrated) {
      /*
       * Race: another process migrated the plan
       * between our list and our migrate call.
       */
      skipped++;

      continue;
    }

    /*
     * Reload the migrated plan to get the new sha256
     * and state for the audit log.
     */
    const reloaded =
      await executionPlanModule
        .loadApprovedExecutionPlan(
          plan.planId
        );

    await auditModule.audit(
      'candidate.execution.plan-migrated',
      {
        planId: plan.planId,
        previousVersion:
          result.fromVersion,
        newVersion: result.toVersion,
        previousSha256:
          plan.sha256,
        newSha256:
          reloaded.sha256,
        status:
          reloaded.state.status,
      }
    );

    migrated++;

    console.log(
      [
        'MIGRATED',
        `PlanId: ${plan.planId}`,
        `Version: ${result.fromVersion} -> ${result.toVersion}`,
        `Status: ${reloaded.state.status}`,
      ].join(' | ')
    );
  }

  console.log(
    `\nMigration complete: ${migrated} migrated, ${skipped} already v2, ${plans.length} total.`
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `Migrate approved plans failed: ${message}`
  );

  process.exitCode = 1;
});
