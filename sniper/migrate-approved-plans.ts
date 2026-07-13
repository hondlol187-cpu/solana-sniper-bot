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
    if (plan.version === 2) {
      skipped++;

      continue;
    }

    const updated =
      await executionPlanModule
        .migrateApprovedExecutionPlan(
          plan.planId
        );

    await auditModule.audit(
      'candidate.execution.plan-migrated',
      {
        planId: plan.planId,
        previousVersion: plan.version,
        newVersion: updated.version,
        previousSha256:
          plan.sha256,
        newSha256:
          updated.sha256,
        status:
          updated.state.status,
      }
    );

    migrated++;

    console.log(
      [
        'MIGRATED',
        `PlanId: ${plan.planId}`,
        `Version: ${plan.version} -> ${updated.version}`,
        `Status: ${updated.state.status}`,
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
