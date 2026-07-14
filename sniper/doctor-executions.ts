export {};

import type {
  ExecutionSettlement,
} from './execution-settlement.js';

import type {
  ExecutionJournal,
} from './execution-journal.js';

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
    settlementModule,
    riskModule,
    configModule,
    rpcModule,
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
    import(
      './execution-settlement.js'
    ),
    import(
      './risk.js'
    ),
    import(
      './config.js'
    ),
    import(
      './rpc.js'
    ),
  ]);

  const errors: string[] = [];
  const warnings: string[] = [];

  let journals:
    ExecutionJournal[] = [];

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

  let settlements:
    ExecutionSettlement[] = [];

  try {
    settlements =
      await settlementModule
        .listExecutionSettlements();
  } catch (error) {
    errors.push(
      `Execution settlement scan failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    settlements = [];
  }

  /*
   * Load the risk state once. This requires a current
   * wallet balance, which we fetch via the RPC pool.
   * If the RPC is unavailable, we skip the risk
   * cross-check rather than failing the entire doctor.
   */
  let activeReservationIds =
    new Set<string>();
  let committedReservationIds =
    new Set<string>();
  let riskStateLoaded = false;

  try {
    const rpcPool =
      new rpcModule.RpcPool();

    await rpcPool.initialize();
    await rpcPool
      .ensureCurrentHealthy();

    const currentBalance =
      BigInt(
        await rpcPool
          .current()
          .getBalance(
            configModule
              .config
              .walletPublicKey,
            'confirmed'
          )
      );

    const riskState =
      await riskModule
        .getRiskState(
          currentBalance
        );

    activeReservationIds =
      new Set(
        riskState.reservations.map(
          (reservation) =>
            reservation.id
        )
      );

    committedReservationIds =
      new Set(
        riskState
          .committedReservationIds
      );

    riskStateLoaded = true;
  } catch (error) {
    warnings.push(
      `Risk state cross-check skipped: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );
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

    const reservationId =
      journal.riskReservationId;

    if (
      riskStateLoaded &&
      (
        journal.status ===
          'broadcasting' ||
        journal.status ===
          'submitted'
      )
    ) {
      if (
        !reservationId ||
        !activeReservationIds.has(
          reservationId
        )
      ) {
        errors.push(
          `Execution ${journal.executionId} has no active risk reservation`
        );
      }
    }

    if (
      journal.status ===
        'broadcasting' ||
      journal.status ===
        'submitted'
    ) {
      warnings.push(
        `Execution ${journal.executionId} is ${journal.status} and requires reconciliation`
      );
    }

    if (
      riskStateLoaded &&
      journal.status ===
        'confirmed'
    ) {
      if (
        !reservationId ||
        !committedReservationIds.has(
          reservationId
        )
      ) {
        errors.push(
          `Confirmed execution ${journal.executionId} has no committed risk reservation`
        );
      }
    }

    if (
      riskStateLoaded &&
      journal.status ===
        'failed' &&
      reservationId &&
      activeReservationIds.has(
        reservationId
      )
    ) {
      warnings.push(
        `Failed execution ${journal.executionId} still has an active risk reservation`
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

  /*
   * Detect orphan reservations: risk reservations
   * that have no matching execution journal.
   */
  const journalReservationIds =
    new Set(
      journals
        .map(
          (journal) =>
            journal
              .riskReservationId
        )
        .filter(
          (
            value
          ): value is string =>
            Boolean(value)
        )
    );

  if (riskStateLoaded) {
    for (
      const reservationId of
      activeReservationIds
    ) {
      if (
        !journalReservationIds.has(
          reservationId
        )
      ) {
        errors.push(
          `Orphan risk reservation ${reservationId} has no execution journal`
        );
      }
    }
  }

  /*
   * Cross-reference settlements against execution journals.
   */
  const journalByExecutionId =
    new Map(
      journals.map(
        (journal) => [
          journal.executionId,
          journal,
        ]
      )
    );

  const settlementByExecutionId =
    new Map<
      string,
      ExecutionSettlement
    >();

  for (
    const settlement of
    settlements
  ) {
    if (
      settlementByExecutionId.has(
        settlement.executionId
      )
    ) {
      errors.push(
        `Execution ${settlement.executionId} has multiple settlement records`
      );

      continue;
    }

    settlementByExecutionId.set(
      settlement.executionId,
      settlement
    );

    const journal =
      journalByExecutionId.get(
        settlement.executionId
      );

    if (!journal) {
      errors.push(
        `Settlement ${settlement.settlementId} has no execution journal`
      );

      continue;
    }

    if (
      settlement.planId !==
        journal.planId ||
      settlement.planInstanceId !==
        journal.planInstanceId ||
      settlement.artifactId !==
        journal.artifactId ||
      settlement.riskReservationId !==
        journal.riskReservationId
    ) {
      errors.push(
        `Settlement ${settlement.settlementId} identity does not match execution journal`
      );
    }

    if (
      settlement.status !==
      'committed'
    ) {
      warnings.push(
        `Settlement ${settlement.settlementId} is incomplete at ${settlement.status}`
      );
    }

    if (
      settlement.status ===
      'committed'
    ) {
      if (
        settlement.outcome ===
          'confirmed' &&
        journal.status !==
          'confirmed'
      ) {
        errors.push(
          `Committed confirmed settlement ${settlement.settlementId} has journal status ${journal.status}`
        );
      }

      if (
        settlement.outcome ===
          'failed' &&
        journal.status !==
          'failed'
      ) {
        errors.push(
          `Committed failed settlement ${settlement.settlementId} has journal status ${journal.status}`
        );
      }

      if (
        settlement.outcome ===
          'confirmed' &&
        journal.confirmedSlot !==
          settlement.observedSlot
      ) {
        errors.push(
          `Confirmed settlement ${settlement.settlementId} slot does not match journal`
        );
      }

      if (
        settlement.outcome ===
          'failed' &&
        journal.failedSlot !==
          settlement.observedSlot
      ) {
        errors.push(
          `Failed settlement ${settlement.settlementId} slot does not match journal`
        );
      }
    }
  }

  /*
   * Detect terminal journals without a settlement record.
   */
  for (const journal of journals) {
    if (
      (
        journal.status ===
          'confirmed' ||
        journal.status ===
          'failed'
      ) &&
      !settlementByExecutionId.has(
        journal.executionId
      )
    ) {
      errors.push(
        `Terminal execution ${journal.executionId} has no settlement journal`
      );
    }
  }

  const report = {
    ok:
      errors.length === 0 &&
      warnings.length === 0,

    journalCount:
      journals.length,

    settlementCount:
      settlements.length,

    incompleteSettlementCount:
      settlements.filter(
        (settlement) =>
          settlement.status !==
          'committed'
      ).length,

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
        `Settlements: ${report.settlementCount}`,
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
