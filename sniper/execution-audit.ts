import {
  createHash,
} from 'node:crypto';

import {
  auditOnce,
} from './audit.js';

import type {
  ExecutionJournal,
} from './execution-journal.js';

function common(
  journal:
    ExecutionJournal
) {
  return {
    executionId:
      journal.executionId,

    planId:
      journal.planId,

    planInstanceId:
      journal.planInstanceId,

    artifactId:
      journal.artifactId,

    riskReservationId:
      journal
        .riskReservationId,

    status:
      journal.status,

    transactionSignature:
      journal
        .transactionSignature,

    journalSha256:
      journal.journalSha256,
  };
}

function eventId(
  event: string,
  journal:
    ExecutionJournal
): string {
  return createHash('sha256')
    .update(
      [
        'execution-audit-v1',
        event,
        journal.executionId,
        journal.status,
        journal.journalSha256,
      ].join(':')
    )
    .digest('hex');
}

function writeOnce(
  event: string,
  journal:
    ExecutionJournal,
  extra: Record<
    string,
    unknown
  > = {}
) {
  return auditOnce(
    event,
    eventId(
      event,
      journal
    ),
    {
      ...common(journal),
      ...extra,
    }
  );
}

export function auditExecutionReady(
  journal:
    ExecutionJournal
) {
  return writeOnce(
    'candidate.execution.ready',
    journal
  );
}

export function auditExecutionBroadcasting(
  journal:
    ExecutionJournal
) {
  return writeOnce(
    'candidate.execution.broadcasting',
    journal,
    {
      signedTransactionSha256:
        journal
          .signedTransactionSha256,

      transactionMessageSha256:
        journal
          .transactionMessageSha256,

      lastValidBlockHeight:
        journal
          .lastValidBlockHeight,
    }
  );
}

export function auditExecutionSubmitted(
  journal:
    ExecutionJournal
) {
  return writeOnce(
    'candidate.execution.submitted',
    journal
  );
}

export function auditExecutionConfirmed(
  journal:
    ExecutionJournal
) {
  return writeOnce(
    'candidate.execution.confirmed',
    journal,
    {
      confirmedSlot:
        journal.confirmedSlot,

      confirmationStatus:
        journal
          .confirmationStatus,
    }
  );
}

export function auditExecutionFailed(
  journal:
    ExecutionJournal
) {
  return writeOnce(
    'candidate.execution.failed',
    journal,
    {
      failedSlot:
        journal.failedSlot,

      failureReason:
        journal.failureReason,
    }
  );
}
