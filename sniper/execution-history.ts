export {};

async function main():
  Promise<void> {
  const [
    planId,
    jsonFlag,
  ] = process.argv.slice(2);

  if (!planId) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:execution-history -- <PLAN_ID> [--json]',
      ].join(' ')
    );
  }

  if (
    jsonFlag !== undefined &&
    jsonFlag !== '--json'
  ) {
    throw new Error(
      'Only --json is supported'
    );
  }

  const [
    planModule,
    journalModule,
    settlementModule,
  ] = await Promise.all([
    import(
      './execution-plan.js'
    ),

    import(
      './execution-journal.js'
    ),

    import(
      './execution-settlement.js'
    ),
  ]);

  const plan =
    await planModule
      .loadApprovedExecutionPlan(
        planId
      );

  const [
    journals,
    settlements,
  ] = await Promise.all([
    journalModule
      .listExecutionJournals(),

    settlementModule
      .listExecutionSettlements(),
  ]);

  const planJournals =
    journals.filter(
      (journal) =>
        journal.planId ===
        planId
    );

  const planSettlements =
    settlements.filter(
      (settlement) =>
        settlement.planId ===
        planId
    );

  const report = {
    planId:
      plan.planId,

    planInstanceId:
      plan.planInstanceId,

    planStatus:
      plan.state.status,

    executionOutcome:
      plan.state
        .executionOutcome ??
      null,

    receipt: plan.state
      .simulationReceipt
      ? {
          artifactId:
            plan.state
              .simulationReceipt
              .artifactId,

          transactionMessageSha256:
            plan.state
              .simulationReceipt
              .transactionMessageSha256,

          transactionPolicySha256:
            plan.state
              .simulationReceipt
              .transactionPolicySha256,
        }
      : null,

    journals:
      planJournals,

    settlements:
      planSettlements,
  };

  if (jsonFlag === '--json') {
    console.log(
      JSON.stringify(
        report,
        null,
        2
      )
    );

    return;
  }

  console.log(
    [
      'EXECUTION HISTORY',
      `PlanId: ${plan.planId}`,
      `PlanStatus: ${plan.state.status}`,
      `Journals: ${planJournals.length}`,
      `Settlements: ${planSettlements.length}`,
      `Outcome: ${
        plan.state
          .executionOutcome
          ?.outcome ??
        'none'
      }`,
    ].join(' | ')
  );

  for (
    const journal of
    planJournals
  ) {
    console.log(
      [
        `ExecutionId: ${journal.executionId}`,
        `Status: ${journal.status}`,
        `Signature: ${
          journal
            .transactionSignature ??
          'none'
        }`,
      ].join(' | ')
    );
  }
}

main().catch(
  (error: unknown) => {
    console.error(
      `Execution history failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 1;
  }
);
