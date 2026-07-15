import {
  listApprovedExecutionPlans,
} from './execution-plan.js';

import {
  listExecutionJournals,
} from './execution-journal.js';

import {
  listExecutionSettlements,
} from './execution-settlement.js';

export interface ExecutionRetentionCandidate {
  planId: string;
  planInstanceId: string;

  outcome:
    | 'confirmed'
    | 'failed';

  recordedAt: string;
  ageMs: number;

  artifactId: string;

  executionIds: string[];
  settlementIds: string[];
}

export async function listExecutionRetentionCandidates(
  minimumAgeMs: number,
  nowMs: number = Date.now()
): Promise<
  ExecutionRetentionCandidate[]
> {
  if (
    !Number.isSafeInteger(
      minimumAgeMs
    ) ||
    minimumAgeMs < 0
  ) {
    throw new Error(
      'Minimum retention age is invalid'
    );
  }

  if (
    !Number.isSafeInteger(
      nowMs
    ) ||
    nowMs < 0
  ) {
    throw new Error(
      'Current time is invalid'
    );
  }

  const [
    plans,
    journals,
    settlements,
  ] = await Promise.all([
    listApprovedExecutionPlans(),

    listExecutionJournals(),

    listExecutionSettlements(),
  ]);

  const candidates:
    ExecutionRetentionCandidate[] =
    [];

  for (const plan of plans) {
    const outcome =
      plan.state
        .executionOutcome;

    if (!outcome) {
      continue;
    }

    const recordedAtMs =
      Date.parse(
        outcome.recordedAt
      );

    if (
      !Number.isFinite(
        recordedAtMs
      )
    ) {
      continue;
    }

    const ageMs =
      nowMs -
      recordedAtMs;

    if (
      ageMs < 0 ||
      ageMs < minimumAgeMs
    ) {
      continue;
    }

    const planJournals =
      journals.filter(
        (journal) =>
          journal.planId ===
            plan.planId &&
          journal
            .planInstanceId ===
            plan.planInstanceId
      );

    const planSettlements =
      settlements.filter(
        (settlement) =>
          settlement.planId ===
            plan.planId &&
          settlement
            .planInstanceId ===
            plan.planInstanceId
      );

    if (
      planJournals.length === 0 ||
      planSettlements.length === 0
    ) {
      continue;
    }

    const allJournalsTerminal =
      planJournals.every(
        (journal) =>
          journal.status ===
            'confirmed' ||
          journal.status ===
            'failed'
      );

    const allSettlementsCommitted =
      planSettlements.every(
        (settlement) =>
          settlement.status ===
          'committed'
      );

    if (
      !allJournalsTerminal ||
      !allSettlementsCommitted
    ) {
      continue;
    }

    const receipt =
      plan.state
        .simulationReceipt;

    if (!receipt?.artifactId) {
      continue;
    }

    const outcomeSettlement =
      planSettlements.find(
        (settlement) =>
          settlement.settlementId ===
          outcome.settlementId
      );

    if (
      !outcomeSettlement ||
      outcomeSettlement.outcome !==
        outcome.outcome ||
      outcomeSettlement.observedSlot !==
        outcome.observedSlot
    ) {
      continue;
    }

    candidates.push({
      planId:
        plan.planId,

      planInstanceId:
        plan.planInstanceId,

      outcome:
        outcome.outcome,

      recordedAt:
        outcome.recordedAt,

      ageMs,

      artifactId:
        receipt.artifactId,

      executionIds:
        planJournals
          .map(
            (journal) =>
              journal.executionId
          )
          .sort(),

      settlementIds:
        planSettlements
          .map(
            (settlement) =>
              settlement
                .settlementId
          )
          .sort(),
    });
  }

  return candidates.sort(
    (left, right) =>
      left.recordedAt
        .localeCompare(
          right.recordedAt
        ) ||
      left.planId
        .localeCompare(
          right.planId
        )
  );
}
