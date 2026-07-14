export {};

import {
  createHash,
} from 'node:crypto';

import {
  VersionedTransaction,
} from '@solana/web3.js';

function sha256(
  value:
    string |
    Buffer |
    Uint8Array
): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

async function main():
  Promise<void> {
  const [planId, jsonFlag] =
    process.argv.slice(2);

  if (!planId) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:verify-simulation-artifact -- <PLAN_ID>',
        'npm run sniper:verify-simulation-artifact -- <PLAN_ID> --json',
      ].join('\n')
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
    executionPlanModule,
    artifactStoreModule,
  ] = await Promise.all([
    import('./execution-plan.js'),
    import(
      './simulation-artifact-store.js'
    ),
  ]);

  const plan =
    await executionPlanModule
      .loadApprovedExecutionPlan(
        planId
      );

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
      'Receipt has no persisted artifact reference'
    );
  }

  const artifact =
    await artifactStoreModule
      .loadSimulationArtifact(
        receipt.artifactId
      );

  const errors: string[] = [];

  if (
    artifact.artifactSha256 !==
    receipt.artifactSha256
  ) {
    errors.push(
      'artifactSha256 mismatch'
    );
  }

  if (
    artifact.planId !==
    plan.planId
  ) {
    errors.push(
      'artifact planId mismatch'
    );
  }

  if (
    artifact.planInstanceId !==
    plan.planInstanceId
  ) {
    errors.push(
      'artifact planInstanceId mismatch'
    );
  }

  if (
    artifact
      .planSha256BeforeSimulation !==
    receipt
      .planSha256BeforeSimulation
  ) {
    errors.push(
      'artifact pre-simulation plan SHA mismatch'
    );
  }

  const transactionBytes =
    Buffer.from(
      artifact
        .serializedTransactionBase64,
        'base64'
    );

  const serializedHash =
    sha256(
      transactionBytes
    );

  if (
    serializedHash !==
    receipt
      .serializedTransactionSha256
  ) {
    errors.push(
      'serialized transaction hash mismatch'
    );
  }

  let transaction:
    VersionedTransaction |
    undefined;

  try {
    transaction =
      VersionedTransaction
        .deserialize(
          transactionBytes
        );
  } catch {
    errors.push(
      'transaction deserialization failed'
    );
  }

  if (transaction) {
    const messageHash =
      sha256(
        transaction.message
          .serialize()
      );

    if (
      messageHash !==
      receipt
        .transactionMessageSha256
    ) {
      errors.push(
        'transaction message hash mismatch'
      );
    }

    if (
      transaction.message
        .recentBlockhash !==
      receipt.recentBlockhash
    ) {
      errors.push(
        'recent blockhash mismatch'
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
      errors.push(
        'fee payer mismatch'
      );
    }
  }

  const logsHash =
    sha256(
      JSON.stringify(
        artifact
          .simulationResponse
          .logs
      )
    );

  if (
    logsHash !==
    receipt.logsSha256
  ) {
    errors.push(
      'simulation logs hash mismatch'
    );
  }

  const returnData =
    artifact
      .simulationResponse
      .returnData;

  const returnDataHash =
    returnData
      ? sha256(
          JSON.stringify({
            programId:
              returnData.programId,
            data: [
              returnData.data[0],
              returnData.data[1],
            ],
          })
        )
      : undefined;

  if (
    returnDataHash !==
    receipt.returnDataSha256
  ) {
    errors.push(
      'simulation return-data hash mismatch'
    );
  }

  if (
    receipt.transactionPolicyOk !==
    true
  ) {
    errors.push(
      'transaction policy is not approved'
    );
  }

  const report = {
    ok:
      errors.length === 0,

    planId:
      plan.planId,

    planInstanceId:
      plan.planInstanceId,

    artifactId:
      artifact.artifactId,

    artifactSha256:
      artifact.artifactSha256,

    serializedTransactionSha256:
      serializedHash,

    transactionMessageSha256:
      receipt
        .transactionMessageSha256,

    errors,
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
        report.ok
          ? 'SIMULATION ARTIFACT VALID'
          : 'SIMULATION ARTIFACT INVALID',

        `PlanId: ${report.planId}`,
        `ArtifactId: ${report.artifactId}`,
        `Errors: ${
          errors.length === 0
            ? 'none'
            : errors.join('; ')
        }`,
      ].join(' | ')
    );
  }

  process.exitCode =
    report.ok
      ? 0
      : 1;
}

main().catch(
  (error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      `Artifact verification failed: ${message}`
    );

    process.exitCode = 2;
  }
);
