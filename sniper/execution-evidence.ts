import {
  createHash,
} from 'node:crypto';

import {
  loadApprovedExecutionPlan,
} from './execution-plan.js';

import {
  loadSimulationArtifact,
  verifyStoredSimulationArtifactRecord,
} from './simulation-artifact-store.js';

import {
  listExecutionJournals,
  verifyExecutionJournalRecord,
} from './execution-journal.js';

import {
  listExecutionSettlements,
  verifyExecutionSettlementRecord,
} from './execution-settlement.js';

import type {
  ApprovedExecutionPlanFile,
} from './execution-plan.js';

import type {
  StoredSimulationArtifact,
} from './simulation-artifact-store.js';

import type {
  ExecutionJournal,
} from './execution-journal.js';

import type {
  ExecutionSettlement,
} from './execution-settlement.js';

export interface ExecutionEvidenceBundle {
  version: 1;

  plan:
    ApprovedExecutionPlanFile;

  artifact:
    StoredSimulationArtifact |
    null;

  journals:
    ExecutionJournal[];

  settlements:
    ExecutionSettlement[];

  bundleSha256: string;
}

function stableStringify(
  value: unknown
): string {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map(stableStringify)
      .join(',')}]`;
  }

  const entries =
    Object.entries(
      value as Record<
        string,
        unknown
      >
    )
      .filter(
        ([, item]) =>
          item !== undefined
      )
      .sort(([left], [right]) =>
        left.localeCompare(right)
      );

  return `{${entries
    .map(
      ([key, item]) =>
        `${JSON.stringify(key)}:${stableStringify(item)}`
    )
    .join(',')}}`;
}

function computeBundleHash(
  bundle:
    Omit<
      ExecutionEvidenceBundle,
      'bundleSha256'
    >
): string {
  return createHash('sha256')
    .update(
      stableStringify(
        bundle
      )
    )
    .digest('hex');
}

export async function buildExecutionEvidenceBundle(
  planId: string
): Promise<
  ExecutionEvidenceBundle
> {
  const plan =
    await loadApprovedExecutionPlan(
      planId
    );

  const [
    allJournals,
    allSettlements,
  ] = await Promise.all([
    listExecutionJournals(),

    listExecutionSettlements(),
  ]);

  const journals =
    allJournals
      .filter(
        (journal) =>
          journal.planId ===
            plan.planId &&
          journal
            .planInstanceId ===
            plan.planInstanceId
      )
      .sort(
        (left, right) =>
          left.createdAt
            .localeCompare(
              right.createdAt
            ) ||
          left.executionId
            .localeCompare(
              right.executionId
            )
      );

  const settlements =
    allSettlements
      .filter(
        (settlement) =>
          settlement.planId ===
            plan.planId &&
          settlement
            .planInstanceId ===
            plan.planInstanceId
      )
      .sort(
        (left, right) =>
          left.createdAt
            .localeCompare(
              right.createdAt
            ) ||
          left.settlementId
            .localeCompare(
              right.settlementId
            )
      );

  const artifactId =
    plan.state
      .simulationReceipt
      ?.artifactId;

  const artifact =
    artifactId
      ? await loadSimulationArtifact(
          artifactId
        )
      : null;

  if (
    artifact &&
    artifact.planId !==
      plan.planId
  ) {
    throw new Error(
      'Evidence artifact belongs to another plan'
    );
  }

  if (
    artifact &&
    artifact.planInstanceId !==
      plan.planInstanceId
  ) {
    throw new Error(
      'Evidence artifact belongs to another plan instance'
    );
  }

  const withoutHash:
    Omit<
      ExecutionEvidenceBundle,
      'bundleSha256'
    > = {
      version: 1,
      plan,
      artifact,
      journals,
      settlements,
    };

  return {
    ...withoutHash,

    bundleSha256:
      computeBundleHash(
        withoutHash
      ),
  };
}

export function verifyExecutionEvidenceBundle(
  bundle:
    ExecutionEvidenceBundle
): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] =
    [];

  if (
    bundle.version !== 1
  ) {
    errors.push(
      'Unsupported evidence bundle version'
    );
  }

  const {
    bundleSha256,
    ...withoutHash
  } = bundle;

  const expectedHash =
    computeBundleHash(
      withoutHash
    );

  if (
    bundleSha256 !==
    expectedHash
  ) {
    errors.push(
      'Evidence bundle hash mismatch'
    );
  }

  if (
    bundle.artifact &&
    bundle.artifact.planId !==
      bundle.plan.planId
  ) {
    errors.push(
      'Artifact plan ID mismatch'
    );
  }

  if (
    bundle.artifact &&
    bundle.artifact
      .planInstanceId !==
      bundle.plan
        .planInstanceId
  ) {
    errors.push(
      'Artifact plan-instance mismatch'
    );
  }

  for (
    const journal of
    bundle.journals
  ) {
    if (
      journal.planId !==
        bundle.plan.planId ||
      journal
        .planInstanceId !==
        bundle.plan
          .planInstanceId
    ) {
      errors.push(
        `Journal ${journal.executionId} identity mismatch`
      );
    }
  }

  const journalIds =
    new Set(
      bundle.journals.map(
        (journal) =>
          journal.executionId
      )
    );

  for (
    const settlement of
    bundle.settlements
  ) {
    if (
      !journalIds.has(
        settlement.executionId
      )
    ) {
      errors.push(
        `Settlement ${settlement.settlementId} has no journal in bundle`
      );
    }
  }

  /*
   * Deep verification: validate every nested record's
   * internal hash and cross-reference fields.
   */

  if (bundle.artifact) {
    try {
      verifyStoredSimulationArtifactRecord(
        bundle.artifact
      );
    } catch (error) {
      errors.push(
        `Artifact validation failed: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }

    const receipt =
      bundle.plan.state
        .simulationReceipt;

    if (!receipt) {
      errors.push(
        'Bundle contains artifact but plan has no simulation receipt'
      );
    } else {
      if (
        receipt.artifactId !==
        bundle.artifact
          .artifactId
      ) {
        errors.push(
          'Receipt artifact ID mismatch'
        );
      }

      if (
        receipt.artifactSha256 !==
        bundle.artifact
          .artifactSha256
      ) {
        errors.push(
          'Receipt artifact SHA-256 mismatch'
        );
      }

      const transactionBytes =
        Buffer.from(
          bundle.artifact
            .serializedTransactionBase64,
          'base64'
        );

      const transactionHash =
        createHash('sha256')
          .update(
            transactionBytes
          )
          .digest('hex');

      if (
        transactionHash !==
        receipt
          .serializedTransactionSha256
      ) {
        errors.push(
          'Artifact transaction bytes do not match receipt'
        );
      }
    }
  }

  for (
    const journal of
    bundle.journals
  ) {
    try {
      verifyExecutionJournalRecord(
        journal
      );
    } catch (error) {
      errors.push(
        `Journal ${journal.executionId} validation failed: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }

    if (
      journal.artifactId !==
      bundle.plan.state
        .simulationReceipt
        ?.artifactId
    ) {
      errors.push(
        `Journal ${journal.executionId} artifact mismatch`
      );
    }
  }

  const journalByExecutionId =
    new Map(
      bundle.journals.map(
        (journal) => [
          journal.executionId,
          journal,
        ]
      )
    );

  for (
    const settlement of
    bundle.settlements
  ) {
    try {
      verifyExecutionSettlementRecord(
        settlement
      );
    } catch (error) {
      errors.push(
        `Settlement ${settlement.settlementId} validation failed: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }

    const journal =
      journalByExecutionId.get(
        settlement.executionId
      );

    if (!journal) {
      errors.push(
        `Settlement ${settlement.settlementId} has no journal`
      );

      continue;
    }

    if (
      settlement.riskReservationId !==
      journal.riskReservationId
    ) {
      errors.push(
        `Settlement ${settlement.settlementId} risk reservation mismatch`
      );
    }

    if (
      settlement.status ===
        'committed' &&
      settlement.outcome ===
        'confirmed' &&
      journal.status !==
        'confirmed'
    ) {
      errors.push(
        `Confirmed settlement ${settlement.settlementId} has non-confirmed journal`
      );
    }

    if (
      settlement.status ===
        'committed' &&
      settlement.outcome ===
        'failed' &&
      journal.status !==
        'failed'
    ) {
      errors.push(
        `Failed settlement ${settlement.settlementId} has non-failed journal`
      );
    }
  }

  const executionOutcome =
    bundle.plan.state
      .executionOutcome;

  if (executionOutcome) {
    const settlement =
      bundle.settlements.find(
        (item) =>
          item.settlementId ===
          executionOutcome
            .settlementId
      );

    if (!settlement) {
      errors.push(
        'Plan execution outcome has no matching settlement'
      );
    } else {
      if (
        settlement.outcome !==
        executionOutcome.outcome
      ) {
        errors.push(
          'Plan outcome does not match settlement outcome'
        );
      }

      if (
        settlement.observedSlot !==
        executionOutcome
          .observedSlot
      ) {
        errors.push(
          'Plan outcome slot does not match settlement'
        );
      }
    }
  }

  return {
    ok:
      errors.length === 0,

    errors,
  };
}
