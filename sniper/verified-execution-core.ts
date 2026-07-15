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

import type {
  FaultInjector,
} from './fault-injection.js';

import {
  noFaults,
} from './fault-injection.js';

import {
  assertEmergencyStopNotActive,
} from './emergency-stop.js';

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
  rpc: VerifiedExecutionRpc,
  faultInjector: FaultInjector = noFaults
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

  /*
   * Canary mode: stricter limits.
   */
  if (
    config.canaryMode
  ) {
    if (
      buyLamports >
      BigInt(
        config
          .maxCanaryExecutionLamports
      )
    ) {
      throw new Error(
        [
          `Plan buy amount ${buyLamports.toString()} exceeds`,
          `MAX_CANARY_EXECUTION_LAMPORTS=${config.maxCanaryExecutionLamports}.`,
        ].join(' ')
      );
    }

    if (
      config
        .canaryAllowedMints
        .length > 0 &&
      !config
        .canaryAllowedMints
        .includes(
          plan
            .payload
            .exactMint
        )
    ) {
      throw new Error(
        `Mint ${plan.payload.exactMint} is not in CANARY_ALLOWED_MINTS`
      );
    }
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

  /*
   * Sellability gate: reject execution if
   * the artifact has a hard-rejected sellability
   * report.
   */
  try {
    const {
      loadSimulationArtifact,
    } = await import(
      './simulation-artifact-store.js'
    );

    const sellArtifact =
      await loadSimulationArtifact(
        receipt.artifactId
      );

    if (
      sellArtifact.sellabilityReport
        ?.hardReject
    ) {
      throw new Error(
        `Sellability hard-reject: ${sellArtifact.sellabilityReport.reasons.join('; ')}`
      );
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes(
        'Sellability hard-reject'
      )
    ) {
      throw error;
    }
    /*
     * Non-sellability errors (e.g. artifact
     * not found) fall through to existing checks.
     */
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

  await assertEmergencyStopNotActive('risk-reservation');

  await reserveTradeOnce(
    riskReservationId,
    plan.payload.exactMint,
    buyLamports,
    currentBalance
  );

  await faultInjector.checkpoint('risk-reserved');

  await assertEmergencyStopNotActive('signing');

  await markExecutionSigning(
    journal.executionId
  );

  await faultInjector.checkpoint('signing-recorded');

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

    await assertEmergencyStopNotActive('broadcasting');

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

    await faultInjector.checkpoint('broadcast-prepared');

    await auditExecutionBroadcasting(
      broadcasting
    );

    await assertEmergencyStopNotActive('broadcast');

    /*
     * Jito execution path selection:
     * If Jito bundles are enabled and tip accounts are
     * configured, attempt bundle submission first.
     * Fall back to standard RPC broadcast if Jito fails
     * or is disabled.
     *
     * Both paths produce the same execution evidence and
     * journal transitions.
     */
    let rpcSignature: string;
    let jitoBundleId: string | undefined;
    let jitoPathUsed = false;
    let jitoFallbackReason: string | undefined;

    const useJito =
      config.enableJitoBundles &&
      config.jitoTipAccounts.length > 0;

    if (useJito) {
      try {
        const { sendJitoBundle } =
          await import('./jito-send.js');

        const encodedTx = signed
          .signedTransactionBytes
          .toString('base64');

        const jitoResult =
          await sendJitoBundle(
            [encodedTx],
            {
              jitoTipAccounts:
                config.jitoTipAccounts,

              jitoApiUrl:
                'https://mainnet.block-engine.jito.wtf/api/v1/bundles',

              tipLamports:
                Math.min(
                  config.jitoTipLamports,
                  config.jitoMaxTipLamports
                ),

              timeoutMs: config.jitoTimeoutMs,

              rpcSendTransaction: async (
                serialized: Buffer
              ) =>
                rpc.sendExactTransaction(
                  serialized
                ),
            }
          );

        if (jitoResult.success && !jitoResult.fallbackUsed) {
          jitoBundleId = jitoResult.bundleId;
          jitoPathUsed = true;

          rpcSignature =
            deterministicSignature;
        } else if (
          jitoResult.success &&
          jitoResult.fallbackUsed
        ) {
          jitoFallbackReason =
            'All Jito endpoints failed';

          rpcSignature =
            deterministicSignature;
        } else {
          if (
            config.jitoRequiredForMainnet &&
            config.expectedCluster ===
              'mainnet-beta'
          ) {
            throw new Error(
              `Jito required for mainnet but failed: ${jitoResult.error}`
            );
          }

          jitoFallbackReason =
            jitoResult.error ??
            'Jito submission failed';

          rpcSignature =
            await rpc.sendExactTransaction(
              signed
                .signedTransactionBytes
            );
        }
      } catch (error) {
        if (
          config.jitoRequiredForMainnet &&
          config.expectedCluster ===
            'mainnet-beta'
        ) {
          throw error;
        }

        jitoFallbackReason =
          error instanceof Error
            ? error.message
            : String(error);

        rpcSignature =
          await rpc.sendExactTransaction(
            signed.signedTransactionBytes
          );
      }
    } else {
      rpcSignature =
        await rpc.sendExactTransaction(
          signed.signedTransactionBytes
        );
    }

    /*
     * Audit Jito path decision for evidence trail.
     */
    try {
      const { audit } =
        await import('./audit.js');

      await audit(
        'execution.broadcast.path',
        {
          executionId:
            journal.executionId,
          jitoPathUsed,
          jitoBundleId,
          jitoFallbackReason,
          signature: rpcSignature,
        }
      );
    } catch {
      /* audit not available in test env */
    }

    await faultInjector.checkpoint('transaction-sent');

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

    await faultInjector.checkpoint('submitted-recorded');

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
