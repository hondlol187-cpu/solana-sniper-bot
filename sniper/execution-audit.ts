import {
  audit,
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

    status:
      journal.status,

    transactionSignature:
      journal
        .transactionSignature,

    journalSha256:
      journal.journalSha256,
  };
}

export function auditExecutionReady(
  journal:
    ExecutionJournal
) {
  return audit(
    'candidate.execution.ready',
    common(journal)
  );
}

export function auditExecutionBroadcasting(
  journal:
    ExecutionJournal
) {
  return audit(
    'candidate.execution.broadcasting',
    {
      ...common(journal),

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
  return audit(
    'candidate.execution.submitted',
    common(journal)
  );
}

export function auditExecutionConfirmed(
  journal:
    ExecutionJournal
) {
  return audit(
    'candidate.execution.confirmed',
    {
      ...common(journal),

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
  return audit(
    'candidate.execution.failed',
    {
      ...common(journal),

      failedSlot:
        journal.failedSlot,

      failureReason:
        journal.failureReason,
    }
  );
}
