import {
  Connection,
} from '@solana/web3.js';

import {
  loadExecutionJournal,
  markExecutionConfirmed,
} from './execution-journal.js';

import type {
  ExecutionJournal,
} from './execution-journal.js';

export interface ExecutionSignatureStatus {
  slot: number;

  confirmationStatus:
    | 'processed'
    | 'confirmed'
    | 'finalized'
    | null;

  err:
    unknown | null;
}

export interface ExecutionStatusRpc {
  getSignatureStatus(
    signature: string
  ): Promise<
    ExecutionSignatureStatus |
    null
  >;
}

export class ConnectionExecutionStatusRpc
implements ExecutionStatusRpc {
  constructor(
    private readonly connection:
      Connection
  ) {}

  async getSignatureStatus(
    signature: string
  ): Promise<
    ExecutionSignatureStatus |
    null
  > {
    const result =
      await this.connection
        .getSignatureStatuses(
          [signature],
          {
            searchTransactionHistory:
              true,
          }
        );

    const status =
      result.value[0];

    if (!status) {
      return null;
    }

    return {
      slot:
        status.slot,

      confirmationStatus:
        status.confirmationStatus ??
        null,

      err:
        status.err ??
        null,
    };
  }
}

export interface ReconciliationResult {
  action:
    | 'none'
    | 'confirmed'
    | 'failed';

  journal:
    ExecutionJournal;

  rpcStatus:
    ExecutionSignatureStatus |
    null;
}

export async function reconcileExecution(
  executionId: string,
  rpc: ExecutionStatusRpc
): Promise<ReconciliationResult> {
  const journal =
    await loadExecutionJournal(
      executionId
    );

  if (!journal) {
    throw new Error(
      'Execution journal does not exist'
    );
  }

  if (
    journal.status === 'confirmed'
  ) {
    return {
      action: 'none',
      journal,
      rpcStatus: null,
    };
  }

  if (
    journal.status === 'failed'
  ) {
    return {
      action: 'none',
      journal,
      rpcStatus: null,
    };
  }

  if (
    journal.status !==
      'broadcasting' &&
    journal.status !==
      'submitted'
  ) {
    throw new Error(
      `Execution has not reached broadcast state; current status is ${journal.status}`
    );
  }

  const signature =
    journal.transactionSignature;

  if (!signature) {
    throw new Error(
      'Submitted execution has no signature'
    );
  }

  let rpcStatus: ExecutionSignatureStatus | null;

  try {
    rpcStatus = await rpc.getSignatureStatus(signature);
  } catch (error) {
    const detail =
      error instanceof Error
        ? error.message
        : String(error);

    throw new Error(
      `Failed to reconcile execution with RPC: ${detail}`
    );
  }

  /*
   * No status is ambiguous. The transaction may still be in
   * flight or the RPC may not have history. Never rebroadcast
   * and never mark it failed based only on a null status.
   */
  if (!rpcStatus) {
    return {
      action: 'none',
      journal,
      rpcStatus: null,
    };
  }

  if (rpcStatus.err !== null) {
    const { markSubmittedExecutionFailed } = await import(
      './execution-journal.js'
    );

    const failed = await markSubmittedExecutionFailed(
      executionId,
      `On-chain transaction error: ${JSON.stringify(rpcStatus.err)}`,
      rpcStatus.slot
    );

    return {
      action: 'failed',
      journal: failed,
      rpcStatus,
    };
  }

  const confirmationStatus =
    rpcStatus
      .confirmationStatus;

  if (
    confirmationStatus ===
      'confirmed' ||
    confirmationStatus ===
      'finalized'
  ) {
    const confirmed =
      await markExecutionConfirmed(
        executionId,
        {
          slot:
            rpcStatus.slot,

          confirmationStatus,
        }
      );

    return {
      action: 'confirmed',
      journal: confirmed,
      rpcStatus,
    };
  }

  return {
    action: 'none',
    journal,
    rpcStatus,
  };
}
