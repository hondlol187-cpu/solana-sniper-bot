import {
  Connection,
} from '@solana/web3.js';

import {
  loadExecutionJournal,
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
     * On-chain failure: route through the crash-consistent
     * settlement journal so risk release, journal transition,
     * and audit are applied atomically and recoverably.
     */
    const {
      settleExecutionOutcome,
    } = await import(
      './execution-settlement.js'
    );

    const balance =
      await rpc.getWalletBalance(
        plan.payload
          .walletPublicKey
      );

    const settlement =
      await settleExecutionOutcome({
        executionId,

        outcome: 'failed',

        observedSlot:
          rpcStatus.slot,

        failureReason:
          `On-chain transaction error: ${JSON.stringify(
            rpcStatus.err
          )}`,

        currentBalanceLamports:
          balance,
      });

    const failed =
      await loadExecutionJournal(
        settlement.executionId
      );

    if (!failed) {
      throw new Error(
        'Execution journal disappeared after settlement'
      );
    }

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
     * Confirmation: route through the crash-consistent
     * settlement journal so risk commit, completed-trade
     * count, journal transition, and audit are applied
     * atomically and recoverably.
     */
    const {
      settleExecutionOutcome,
    } = await import(
      './execution-settlement.js'
    );

    const balance =
      await rpc.getWalletBalance(
        plan.payload
          .walletPublicKey
      );

    const settlement =
      await settleExecutionOutcome({
        executionId,

        outcome: 'confirmed',

        observedSlot:
          rpcStatus.slot,

        confirmationStatus,

        currentBalanceLamports:
          balance,
      });

    const confirmed =
      await loadExecutionJournal(
        settlement.executionId
      );

    if (!confirmed) {
      throw new Error(
        'Execution journal disappeared after settlement'
      );
    }

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
