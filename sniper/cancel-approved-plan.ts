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

  // Best-effort capture of the previous status before the
  // atomic transition. If the plan is missing or corrupt,
  // cancelApprovedExecutionPlan will throw the real error;
  // the audit is only emitted on success below.
  let previousStatus = 'unknown';

  try {
    const before =
      await executionPlanModule.loadApprovedExecutionPlan(
        planId
      );

    previousStatus =
      before.state.status;
  } catch {
    /*
     * Swallow — cancelApprovedExecutionPlan will throw a
     * more specific error if the plan truly doesn't exist.
     */
  }

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
      previousStatus,
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
      `PreviousStatus: ${previousStatus}`,
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
