export {};

import {
  createHash,
} from 'node:crypto';

import {
  VersionedTransaction,
} from '@solana/web3.js';

function sha256(
  value:
    Buffer |
    Uint8Array
): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

async function main():
  Promise<void> {
  const [
    planId,
    jsonFlag,
  ] = process.argv.slice(2);

  if (!planId) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:preview-verified-execution -- ',
        '<PLAN_ID> [--json]',
      ].join('')
    );
  }

  if (
    jsonFlag !== undefined &&
    jsonFlag !== '--json'
  ) {
    throw new Error(
      'Only --json is supported'
    );
  }

  const [
    planModule,
    artifactModule,
  ] = await Promise.all([
    import(
      './execution-plan.js'
    ),

    import(
      './simulation-artifact-store.js'
    ),
  ]);

  const plan =
    await planModule
      .loadApprovedExecutionPlan(
        planId
      );

  if (
    plan.state.status !==
    'simulated'
  ) {
    throw new Error(
      `Plan is not simulated; status is ${plan.state.status}`
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
    !receipt.artifactId ||
    !receipt.artifactSha256
  ) {
    throw new Error(
      'Receipt has no persisted artifact'
    );
  }

  const bytes =
    await artifactModule
      .loadVerifiedArtifactBytes(
        receipt,
        plan.planId,
        plan.planInstanceId
      );

  const transaction =
    VersionedTransaction
      .deserialize(bytes);

  const serializedHash =
    sha256(bytes);

  const messageHash =
    sha256(
      transaction.message
        .serialize()
    );

  if (
    serializedHash !==
    receipt
      .serializedTransactionSha256
  ) {
    throw new Error(
      'Preview transaction hash does not match receipt'
    );
  }

  if (
    messageHash !==
    receipt
      .transactionMessageSha256
  ) {
    throw new Error(
      'Preview message hash does not match receipt'
    );
  }

  const feePayer =
    transaction.message
      .staticAccountKeys[0]
      ?.toBase58();

  if (
    feePayer !==
    receipt.walletPublicKey
  ) {
    throw new Error(
      'Preview fee payer does not match receipt'
    );
  }

  const confirmationPhrase =
    [
      'CONFIRM',
      plan.planId,
      receipt.artifactId,
      plan.payload.buyLamports,
      plan.payload.exactMint,
    ].join(':');

  const report = {
    planId:
      plan.planId,

    planInstanceId:
      plan.planInstanceId,

    artifactId:
      receipt.artifactId,

    walletPublicKey:
      receipt.walletPublicKey,

    expectedCluster:
      receipt.expectedCluster,

    exactMint:
      plan.payload.exactMint,

    buyLamports:
      plan.payload.buyLamports,

    recentBlockhash:
      receipt.recentBlockhash,

    lastValidBlockHeight:
      receipt
        .lastValidBlockHeight,

    simulatedAt:
      receipt.simulatedAt,

    serializedTransactionSha256:
      serializedHash,

    transactionMessageSha256:
      messageHash,

    transactionPolicySha256:
      receipt
        .transactionPolicySha256,

    transactionPolicyOk:
      receipt
        .transactionPolicyOk,

    confirmationPhrase,
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
        'VERIFIED EXECUTION PREVIEW',
        `PlanId: ${report.planId}`,
        `ArtifactId: ${report.artifactId}`,
        `Wallet: ${report.walletPublicKey}`,
        `Cluster: ${report.expectedCluster}`,
        `Mint: ${report.exactMint}`,
        `BuyLamports: ${report.buyLamports}`,
        `MessageSha256: ${report.transactionMessageSha256}`,
      ].join(' | ')
    );

    console.log(
      `Confirmation: ${confirmationPhrase}`
    );
  }
}

main().catch(
  (error: unknown) => {
    console.error(
      `Execution preview failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 1;
  }
);
