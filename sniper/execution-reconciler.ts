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

import {
  auditExecutionConfirmed,
  auditExecutionFailed,
} from './execution-audit.js';

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

  getWalletBalance(
    walletPublicKey: string
  ): Promise<bigint>;
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

  async getWalletBalance(
    walletPublicKey: string
  ): Promise<bigint> {
    const {
      PublicKey,
    } = await import(
      '@solana/web3.js'
    );

    const balance =
      await this.connection
        .getBalance(
          new PublicKey(
            walletPublicKey
          ),
          'confirmed'
        );

    return BigInt(balance);
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

  /*
   * Load the plan to get the wallet public key (for balance
   * queries) and to verify the journal's planInstanceId.
   */
  const {
    loadApprovedExecutionPlan,
  } = await import(
    './execution-plan.js'
  );

  const plan =
    await loadApprovedExecutionPlan(
      journal.planId
    );

  if (
    plan.planInstanceId !==
    journal.planInstanceId
  ) {
    throw new Error(
      'Execution journal plan-instance mismatch'
    );
  }

  const riskReservationId =
    journal.riskReservationId;

  if (!riskReservationId) {
    throw new Error(
      'Execution journal has no risk reservation'
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
    /*
     * On-chain failure: release the risk reservation BEFORE
     * marking the journal failed. Ordering: risk release →
     * journal failed → audit. If the process crashes between
     * steps, rerunning reconciliation is safe:
     *   - If the journal is still 'broadcasting'/'submitted',
     *     releaseReservationIfPresent returns {released:false}
     *     on the second run (reservation already gone) and the
     *     journal transition proceeds.
     *   - If the journal already reached 'failed', the top-of-
     *     function early-return handles idempotency.
     */
    const {
      releaseReservationIfPresent,
    } = await import(
      './risk.js'
    );

    const balance =
      await rpc.getWalletBalance(
        plan.payload
          .walletPublicKey
      );

    await releaseReservationIfPresent(
      riskReservationId,
      plan.payload.exactMint,
      balance
    );

    const { markSubmittedExecutionFailed } = await import(
      './execution-journal.js'
    );

    const failed = await markSubmittedExecutionFailed(
      executionId,
      `On-chain transaction error: ${JSON.stringify(rpcStatus.err)}`,
      rpcStatus.slot
    );

    await auditExecutionFailed(
      failed
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
    /*
     * Confirmation: commit the risk reservation and record
     * the completed trade BEFORE marking the journal
     * confirmed. Ordering: risk commit → completed count →
     * journal confirmed → audit. Both commitReservation and
     * recordTradeCompleted are idempotent, so a crash between
     * steps is safe on rerun (the top-of-function early-return
     * handles a journal that already reached 'confirmed').
     */
    const {
      commitReservation,
      recordTradeCompleted,
    } = await import(
      './risk.js'
    );

    const balance =
      await rpc.getWalletBalance(
        plan.payload
          .walletPublicKey
      );

    await commitReservation(
      riskReservationId,
      balance
    );

    await recordTradeCompleted(
      journal.executionId,
      balance
    );

    const confirmed =
      await markExecutionConfirmed(
        executionId,
        {
          slot:
            rpcStatus.slot,

          confirmationStatus,
        }
      );

    await auditExecutionConfirmed(
      confirmed
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
