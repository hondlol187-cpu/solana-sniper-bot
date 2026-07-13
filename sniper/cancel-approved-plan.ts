export {};

async function main(): Promise<void> {
  const [
    planId,
    ...reasonParts
  ] = process.argv.slice(2);

  if (!planId) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:cancel-approved-plan -- <plan-id> <reason>',
      ].join('\n')
    );
  }

  const reason =
    reasonParts.join(' ').trim();

  if (!reason) {
    throw new Error(
      'Cancellation reason is required'
    );
  }

  const [
    executionPlanModule,
    auditModule,
  ] = await Promise.all([
    import('./execution-plan.js'),
    import('./audit.js'),
  ]);

  const updated =
    await executionPlanModule
      .cancelApprovedExecutionPlan(
        planId,
        reason
      );

  await auditModule.audit(
    'candidate.execution.plan-cancelled',
    {
      planId,
      status:
        updated.state.status,
      previousStatus:
        undefined,
      reason,
      planSha256:
        updated.sha256,
      simulationCount:
        updated.state.simulationCount,
    }
  );

  console.log(
    [
      'APPROVED PLAN CANCELLED',
      `PlanId: ${planId}`,
      `Status: ${updated.state.status}`,
      `Reason: ${reason}`,
      `PlanSha256: ${updated.sha256}`,
    ].join(' | ')
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `Cancel approved plan failed: ${message}`
  );

  process.exitCode = 1;
});
