export {};

async function main():
  Promise<void> {
  const [jsonFlag] =
    process.argv.slice(2);

  if (
    jsonFlag !== undefined &&
    jsonFlag !== '--json'
  ) {
    throw new Error(
      'Usage: npm run sniper:doctor-executions -- [--json]'
    );
  }

  const [
    journalModule,
    artifactModule,
    executionPlanModule,
  ] = await Promise.all([
    import(
      './execution-journal.js'
    ),
    import(
      './simulation-artifact-store.js'
    ),
    import(
      './execution-plan.js'
    ),
  ]);

  const errors: string[] = [];
  const warnings: string[] = [];

  let journals;

  try {
    journals =
      await journalModule
        .listExecutionJournals();
  } catch (error) {
    errors.push(
      `Execution journal scan failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    journals = [];
  }

  for (const journal of journals) {
    let plan;

    try {
      plan =
        await executionPlanModule
          .loadApprovedExecutionPlan(
            journal.planId
          );
    } catch (error) {
      errors.push(
        `Execution ${journal.executionId} references missing or invalid plan ${journal.planId}`
      );

      continue;
    }

    if (
      plan.planInstanceId !==
      journal.planInstanceId
    ) {
      errors.push(
        `Execution ${journal.executionId} plan-instance mismatch`
      );
    }

    const receipt =
      plan.state
        .simulationReceipt;

    if (!receipt) {
      errors.push(
        `Execution ${journal.executionId} plan has no simulation receipt`
      );

      continue;
    }

    if (
      receipt.artifactId !==
      journal.artifactId
    ) {
      errors.push(
        `Execution ${journal.executionId} artifact mismatch`
      );
    }

    try {
      await artifactModule
        .loadSimulationArtifact(
          journal.artifactId
        );
    } catch (error) {
      errors.push(
        `Execution ${journal.executionId} artifact is missing or corrupt`
      );
    }

    if (
      journal.status ===
      'broadcasting'
    ) {
      warnings.push(
        `Execution ${journal.executionId} is broadcasting and requires reconciliation`
      );
    }

    if (
      journal.status ===
      'submitted'
    ) {
      warnings.push(
        `Execution ${journal.executionId} is submitted and requires reconciliation`
      );
    }

    if (
      journal.status ===
      'signing'
    ) {
      const ageMs =
        Date.now() -
        Date.parse(
          journal.updatedAt
        );

      if (
        ageMs >
        60_000
      ) {
        warnings.push(
          `Execution ${journal.executionId} has been signing for ${ageMs}ms`
        );
      }
    }
  }

  const report = {
    ok:
      errors.length === 0 &&
      warnings.length === 0,

    journalCount:
      journals.length,

    errors,
    warnings,
  };

  if (jsonFlag === '--json') {
    console.log(
      JSON.stringify(
        report,
        null,
        2
      )
    );
  } else {
    console.log(
      [
        report.ok
          ? 'EXECUTION STATE HEALTHY'
          : 'EXECUTION STATE NEEDS ATTENTION',

        `Journals: ${report.journalCount}`,
        `Errors: ${errors.length}`,
        `Warnings: ${warnings.length}`,
      ].join(' | ')
    );

    for (const error of errors) {
      console.error(
        `ERROR: ${error}`
      );
    }

    for (const warning of warnings) {
      console.warn(
        `WARNING: ${warning}`
      );
    }
  }

  process.exitCode =
    errors.length > 0
      ? 2
      : warnings.length > 0
        ? 1
        : 0;
}

main().catch(
  (error: unknown) => {
    console.error(
      `Execution doctor failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 3;
  }
);
