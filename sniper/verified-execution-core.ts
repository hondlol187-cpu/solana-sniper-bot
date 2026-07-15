import {
  createHash,
} from 'node:crypto';

import {
  Keypair,
} from '@solana/web3.js';

import bs58 from 'bs58';

import {
  config,
} from './config.js';

import type {
  VerifiedExecutionRpc,
} from './verified-execution-rpc.js';

import {
  loadApprovedExecutionPlan,
} from './execution-plan.js';

import {
  loadVerifiedArtifactBytes,
} from './simulation-artifact-store.js';

import {
  signVerifiedSimulationTransaction,
} from './verified-transaction.js';

import {
  beginExecution,
  markExecutionBroadcastReady,
  markExecutionFailed,
  markExecutionSigning,
  markExecutionSubmitted,
} from './execution-journal.js';

import {
  auditExecutionBroadcasting,
  auditExecutionFailed,
  auditExecutionReady,
  auditExecutionSubmitted,
} from './execution-audit.js';

import {
  releaseReservation,
  reserveTradeOnce,
} from './risk.js';

function sha256(
  value:
    Buffer |
    Uint8Array
): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

export interface VerifiedExecutionResult {
  executionId: string;
  transactionSignature: string;
  status: 'submitted';
}

export async function executeVerifiedPlan(
  planId: string,
  signer: Keypair,
  rpc: VerifiedExecutionRpc
): Promise<VerifiedExecutionResult> {
  if (!config.liveTrading) {
    throw new Error(
      'LIVE_TRADING=true is required'
    );
  }

  if (
    config.expectedCluster ===
      'mainnet-beta' &&
    !config.enableMainnetExecution
  ) {
    throw new Error(
      [
        'Mainnet execution is disabled.',
        'Set ENABLE_MAINNET_EXECUTION=true only after reviewing the exact plan and artifact.',
      ].join(' ')
    );
  }

  const plan =
    await loadApprovedExecutionPlan(
      planId
    );

  if (
    plan.state.status !==
    'simulated'
  ) {
    throw new Error(
      `Plan is not ready for execution; status is ${plan.state.status}`
    );
  }

  let buyLamports: bigint;

  try {
    buyLamports =
      BigInt(
        plan.payload.buyLamports
      );
  } catch {
    throw new Error(
      'Plan buyLamports is invalid'
    );
  }

  if (
    buyLamports <= 0n
  ) {
    throw new Error(
      'Plan buy amount must be positive'
    );
  }

  if (
    buyLamports >
    BigInt(
      config
        .maxLiveExecutionLamports
    )
  ) {
    throw new Error(
      [
        `Plan buy amount ${buyLamports.toString()} exceeds`,
        `MAX_LIVE_EXECUTION_LAMPORTS=${config.maxLiveExecutionLamports}.`,
      ].join(' ')
    );
  }

  const receipt =
    plan.state
      .simulationReceipt;

  if (!receipt) {
    throw new Error(
      'Plan has no simulation receipt'
    );
  }

  if (
    receipt.transactionPolicyOk !==
    true
  ) {
    throw new Error(
      'Receipt transaction policy is not approved'
    );
  }

  if (
    !receipt.artifactId ||
    !receipt.artifactSha256
  ) {
    throw new Error(
      'Receipt has no persisted artifact'
    );
  }

  if (
    receipt.expectedCluster !==
    config.expectedCluster
  ) {
    throw new Error(
      'Receipt cluster does not match configured cluster'
    );
  }

  if (
    receipt.walletPublicKey !==
    signer.publicKey.toBase58()
  ) {
    throw new Error(
      'Signer does not match receipt wallet'
    );
  }

  const simulatedAtMs =
    Date.parse(
      receipt.simulatedAt
    );

  if (
    !Number.isFinite(
      simulatedAtMs
    ) ||
    Date.now() -
      simulatedAtMs < 0 ||
    Date.now() -
      simulatedAtMs >
      config
        .maxLiveExecutionReceiptAgeSeconds *
      1_000
  ) {
    throw new Error(
      'Simulation receipt is too old for execution'
    );
  }

  if (
    receipt.lastValidBlockHeight ===
    undefined
  ) {
    throw new Error(
      'Receipt has no lastValidBlockHeight'
    );
  }

  const [
    blockhashValid,
    currentBlockHeight,
  ] = await Promise.all([
    rpc.isBlockhashValid(
      receipt.recentBlockhash
    ),

    rpc.getCurrentBlockHeight(),
  ]);

  if (!blockhashValid) {
    throw new Error(
      'Verified blockhash is no longer valid'
    );
  }

  if (
    currentBlockHeight >
    receipt.lastValidBlockHeight
  ) {
    throw new Error(
      'Verified transaction has expired'
    );
  }

  const artifactBytes =
    await loadVerifiedArtifactBytes(
      receipt,
      plan.planId,
      plan.planInstanceId
    );

  const journal =
    await beginExecution(
      plan.planId,
      plan.planInstanceId,
      receipt.artifactId
    );

  if (
    journal.status !==
    'ready'
  ) {
    throw new Error(
      `Execution cannot start from ${journal.status}`
    );
  }

  await auditExecutionReady(
    journal
  );

  const riskReservationId =
    journal
      .riskReservationId;

  if (!riskReservationId) {
    throw new Error(
      'Execution journal has no risk reservation ID'
    );
  }

  const currentBalance =
    await rpc.getWalletBalance(
      signer.publicKey
    );

  const requiredBalance =
    buyLamports +
    BigInt(
      config
        .minimumFeeReserveLamports
    );

  if (
    currentBalance <
    requiredBalance
  ) {
    throw new Error(
      [
        'Wallet balance is insufficient for verified execution.',
        `Balance: ${currentBalance.toString()}.`,
        `Required: ${requiredBalance.toString()}.`,
      ].join(' ')
    );
  }

  await reserveTradeOnce(
    riskReservationId,
    plan.payload.exactMint,
    buyLamports,
    currentBalance
  );

  await markExecutionSigning(
    journal.executionId
  );

  let broadcastPrepared =
    false;

  try {
    const signed =
      signVerifiedSimulationTransaction(
        artifactBytes,
        receipt,
        signer
      );

    const signatureBytes =
      signed
        .signedTransaction
        .signatures[0];

    if (!signatureBytes) {
      throw new Error(
        'Signed transaction has no signature'
      );
    }

    const deterministicSignature =
      bs58.encode(
        signatureBytes
      );

    const broadcasting =
      await markExecutionBroadcastReady(
        journal.executionId,
        {
          transactionSignature:
            deterministicSignature,

          signedTransactionSha256:
            sha256(
              signed
                .signedTransactionBytes
            ),

          transactionMessageSha256:
            signed
              .transactionMessageSha256,

          lastValidBlockHeight:
            receipt
              .lastValidBlockHeight,
        }
      );

    /*
     * broadcastPrepared is set BEFORE the audit call so that
     * if the audit throws, the catch block leaves the journal
     * in 'broadcasting' (an audit failure after durable
     * evidence is recorded is treated the same as a send
     * error — ambiguous, never resend).
     */
    broadcastPrepared =
      true;

    await auditExecutionBroadcasting(
      broadcasting
    );

    const rpcSignature =
      await rpc.sendExactTransaction(
        signed
          .signedTransactionBytes
      );

    if (
      rpcSignature !==
      deterministicSignature
    ) {
      throw new Error(
        'RPC returned a different signature'
      );
    }

    const submitted =
      await markExecutionSubmitted(
        journal.executionId,
        rpcSignature
      );

    await auditExecutionSubmitted(
      submitted
    );

    return {
      executionId:
        journal.executionId,

      transactionSignature:
        rpcSignature,

      status: 'submitted',
    };
  } catch (error) {
    /*
     * After broadcasting is prepared, any send error is
     * ambiguous. Leave the journal in broadcasting and
     * reconcile by deterministic signature. Never resend.
     */
    if (!broadcastPrepared) {
      const failed =
        await markExecutionFailed(
          journal.executionId,
          error instanceof Error
            ? error.message
            : String(error)
        );

      await auditExecutionFailed(
        failed
      );

      try {
        const balance =
          await rpc.getWalletBalance(
            signer.publicKey
          );

        await releaseReservation(
          riskReservationId,
          plan.payload.exactMint,
          balance
        );
      } catch {
        /*
         * Fail closed: leave unresolved reservation visible
         * for doctor/recovery rather than hiding the original
         * execution error.
         */
      }
    }

    throw error;
  }
}
