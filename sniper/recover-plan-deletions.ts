export {};

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

  const commit = args.includes(
    '--commit'
  );

  const [
    planAuditModule,
    executionPlanModule,
  ] = await Promise.all([
    import('./plan-audit.js'),
    import('./execution-plan.js'),
  ]);

  /*
   * Assess current journal health before recovery.
   */
  const healthBefore =
    await planAuditModule.assessDeletionJournalHealth();

  if (
    healthBefore.pending === 0 &&
    healthBefore.ledgerRecorded === 0 &&
    healthBefore.committedButPlanExists === 0
  ) {
    const emptyResult = {
      dryRun,
      recovered: [] as string[],
      pending: [] as string[],
      conflicts: [] as string[],
      removedPlans: [] as string[],
      summary: {
        pendingBefore: 0,
        ledgerRecordedBefore: 0,
        committedButPlanExistsBefore: 0,
        recovered: 0,
        pending: 0,
        conflicts: 0,
        removedPlans: 0,
      },
    };

    if (jsonMode) {
      console.log(
        JSON.stringify(
          emptyResult,
          null,
          2
        )
      );
    } else {
      console.log(
        'No pending deletion journals to recover.'
      );
    }

    return;
  }

  /*
   * In dry-run mode, report what would be recovered
   * without actually doing anything.
   */
  if (dryRun) {
    const unresolved =
      healthBefore.journals.filter(
        (j) =>
          j.status === 'pending' ||
          j.status === 'ledger-recorded'
      );

    const result = {
      dryRun: true,
      wouldRecover:
        unresolved.map(
          (j) => j.deletionId
        ),
      committedButPlanExists:
        healthBefore.journals
          .filter(
            (j) =>
              j.status === 'committed'
          )
          .map((j) => j.deletionId),
      summary: {
        pendingBefore:
          healthBefore.pending,
        ledgerRecordedBefore:
          healthBefore.ledgerRecorded,
        committedButPlanExistsBefore:
          healthBefore.committedButPlanExists,
        wouldRecover:
          unresolved.length,
        conflicts:
          healthBefore.conflicts,
      },
    };

    if (jsonMode) {
      console.log(
        JSON.stringify(result, null, 2)
      );
    } else {
      console.log(
        `Dry run — would recover ${unresolved.length} journal${unresolved.length === 1 ? '' : 's'}:`
      );

      for (const j of unresolved) {
        console.log(
          [
            `  DeletionId: ${j.deletionId}`,
            `PlanId: ${j.planId}`,
            `Status: ${j.status}`,
          ].join(' | ')
        );
      }

      if (
        healthBefore.committedButPlanExists >
        0
      ) {
        console.log(
          `\nWould also remove ${healthBefore.committedButPlanExists} plan file${healthBefore.committedButPlanExists === 1 ? '' : 's'} with committed journals:`
        );

        for (const j of healthBefore.journals.filter(
          (j) => j.status === 'committed'
        )) {
          console.log(
            `  ${j.planId} (deletionId: ${j.deletionId})`
          );
        }
      }

      console.log(
        `\nNo files were modified (dry run).`
      );
    }

    return;
  }

  /*
   * Live recovery: resume pending/ledger-recorded
   * journals to committed, then remove plan files
   * for committed journals (if --commit is set).
   */
  const recovery =
    await planAuditModule.recoverPendingPlanDeletions();

  const removedPlans: string[] = [];

  /*
   * If --commit is set, remove plan files for
   * committed journals whose plans still exist.
   */
  if (commit) {
    const healthAfter =
      await planAuditModule.assessDeletionJournalHealth();

    for (const j of healthAfter.journals.filter(
      (j) => j.status === 'committed'
    )) {
      try {
        await executionPlanModule.deleteApprovedExecutionPlan(
          j.planId,
          {
            reason: `recover:${j.deletionId}`,
            recordTombstone: false,
          }
        );

        removedPlans.push(j.planId);
      } catch {
        /*
         * Plan may already be gone, or deletion
         * failed. Skip — doctor will report it.
         */
      }
    }
  }

  const summary = {
    pendingBefore:
      healthBefore.pending,
    ledgerRecordedBefore:
      healthBefore.ledgerRecorded,
    committedButPlanExistsBefore:
      healthBefore.committedButPlanExists,
    recovered: recovery.recovered.length,
    pending: recovery.pending.length,
    conflicts: recovery.conflicts.length,
    removedPlans: removedPlans.length,
  };

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          dryRun: false,
          recovered: recovery.recovered,
          pending: recovery.pending,
          conflicts: recovery.conflicts,
          removedPlans,
          summary,
        },
        null,
        2
      )
    );
  } else {
    console.log(
      `Recovery complete:`
    );
    console.log(
      `  Recovered: ${recovery.recovered.length}`
    );
    console.log(
      `  Pending: ${recovery.pending.length}`
    );
    console.log(
      `  Conflicts: ${recovery.conflicts.length}`
    );
    console.log(
      `  Removed plans: ${removedPlans.length}`
    );

    if (recovery.recovered.length > 0) {
      console.log(
        `\nRecovered journals:`
      );

      for (const id of recovery.recovered) {
        console.log(`  ${id}`);
      }
    }

    if (recovery.pending.length > 0) {
      console.log(
        `\nPending (plan file missing or unloadable):`
      );

      for (const id of recovery.pending) {
        console.log(`  ${id}`);
      }
    }

    if (recovery.conflicts.length > 0) {
      console.log(
        `\nConflicts (plan SHA mismatch):`
      );

      for (const id of recovery.conflicts) {
        console.log(`  ${id}`);
      }
    }

    if (!commit) {
      console.log(
        `\nNote: --commit not set, committed journal plan files were not removed.`
      );
    }
  }

  if (recovery.conflicts.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `Recover plan deletions failed: ${message}`
  );

  process.exitCode = 1;
});
