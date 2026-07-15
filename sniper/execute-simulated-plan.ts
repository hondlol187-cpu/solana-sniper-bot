export {};

function usage(): string {
  return [
    'Usage:',
    'npm run sniper:execute-simulated-plan -- ',
    '<PLAN_ID> --live CONFIRM:<PLAN_ID>:<ARTIFACT_ID>',
  ].join('');
}

async function main():
  Promise<void> {
  const [
    planId,
    mode,
    confirmation,
  ] = process.argv.slice(2);

  if (
    !planId ||
    mode !== '--live' ||
    !confirmation
  ) {
    throw new Error(
      usage()
    );
  }

  if (
    process.env.LIVE_TRADING !==
    'true'
  ) {
    throw new Error(
      'LIVE_TRADING=true is required'
    );
  }

  const [
    configModule,
    executionPlanModule,
    executionModule,
    rpcModule,
  ] = await Promise.all([
    import('./config.js'),

    import(
      './execution-plan.js'
    ),

    import(
      './verified-execution-core.js'
    ),

    import('./rpc.js'),
  ]);

  const plan =
    await executionPlanModule
      .loadApprovedExecutionPlan(
        planId
      );

  if (
    plan.state.status !==
    'simulated'
  ) {
    throw new Error(
      `Plan is not simulated; current status is ${plan.state.status}`
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

  if (!receipt.artifactId) {
    throw new Error(
      'Simulation receipt has no artifact ID'
    );
  }

  if (
    configModule
      .config
      .expectedCluster ===
      'mainnet-beta' &&
    process.env
      .ENABLE_MAINNET_EXECUTION !==
      'true'
  ) {
    throw new Error(
      'ENABLE_MAINNET_EXECUTION=true is required for mainnet'
    );
  }

  const expectedConfirmation =
    [
      'CONFIRM',
      planId,
      receipt.artifactId,
      plan.payload.buyLamports,
      plan.payload.exactMint,
    ].join(':');

  if (
    confirmation !==
    expectedConfirmation
  ) {
    throw new Error(
      [
        'Exact confirmation phrase required.',
        `Expected: ${expectedConfirmation}`,
      ].join(' ')
    );
  }

  const signer =
    configModule
      .config
      .keypair;

  if (!signer) {
    throw new Error(
      [
        'Secure execution signer is unavailable.',
        'Configure PRIVATE_KEY_FILE with mode 0600.',
      ].join(' ')
    );
  }

  if (
    !signer.publicKey.equals(
      configModule
        .config
        .walletPublicKey
    )
  ) {
    throw new Error(
      'Execution signer does not match configured wallet'
    );
  }

  const rpcPool =
    new rpcModule.RpcPool();

  await rpcPool.initialize();

  await rpcPool
    .ensureCurrentHealthy();

  const {
    ConnectionVerifiedExecutionRpc,
  } = await import(
    './verified-execution-rpc.js'
  );

  const executionRpc =
    new ConnectionVerifiedExecutionRpc(
      rpcPool.current()
    );

  const result =
    await executionModule
      .executeVerifiedPlan(
        planId,
        signer,
        executionRpc
      );

  console.log(
    [
      'VERIFIED EXECUTION SUBMITTED',
      `PlanId: ${planId}`,
      `ArtifactId: ${receipt.artifactId}`,
      `ExecutionId: ${result.executionId}`,
      `Signature: ${result.transactionSignature}`,
      'No automatic rebroadcast will occur.',
      'Run sniper:reconcile-executions to determine final status.',
    ].join(' | ')
  );
}

main().catch(
  (error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      `Verified execution failed: ${message}`
    );

    process.exitCode = 1;
  }
);
