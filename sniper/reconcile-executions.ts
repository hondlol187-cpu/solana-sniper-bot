export {};

async function main(): Promise<void> {
  const [jsonFlag] = process.argv.slice(2);

  if (
    jsonFlag !== undefined &&
    jsonFlag !== '--json'
  ) {
    throw new Error(
      'Usage: npm run sniper:reconcile-executions -- [--json]'
    );
  }

  const [
    journalModule,
    reconcilerModule,
    rpcModule,
  ] = await Promise.all([
    import('./execution-journal.js'),
    import('./execution-reconciler.js'),
    import('./rpc.js'),
  ]);

  const rpcPool = new rpcModule.RpcPool();

  await rpcPool.initialize();
  await rpcPool.ensureCurrentHealthy();

  const rpc = new reconcilerModule.ConnectionExecutionStatusRpc(
    rpcPool.current()
  );

  const journals = await journalModule.listExecutionJournals();

  const results: Array<{
    executionId: string;
    previousStatus: string;
    currentStatus: string;
    action: string;
    error?: string;
  }> = [];

  for (const journal of journals) {
    if (
      journal.status !==
        'broadcasting' &&
      journal.status !==
        'submitted'
    ) {
      continue;
    }

    try {
      const result = await reconcilerModule.reconcileExecution(
        journal.executionId,
        rpc
      );

      results.push({
        executionId: journal.executionId,
        previousStatus: journal.status,
        currentStatus: result.journal.status,
        action: result.action,
      });
    } catch (error) {
      results.push({
        executionId: journal.executionId,
        previousStatus: journal.status,
        currentStatus: journal.status,
        action: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (jsonFlag === '--json') {
    console.log(
      JSON.stringify(
        {
          checked: results.length,
          confirmed: results.filter((item) => item.action === 'confirmed').length,
          failed: results.filter((item) => item.action === 'failed').length,
          errors: results.filter((item) => item.action === 'error').length,
          results,
        },
        null,
        2
      )
    );
  } else {
    for (const result of results) {
      console.log(
        [
          `ExecutionId: ${result.executionId}`,
          `Previous: ${result.previousStatus}`,
          `Current: ${result.currentStatus}`,
          `Action: ${result.action}`,
          ...(result.error ? [`Error: ${result.error}`] : []),
        ].join(' | ')
      );
    }

    if (results.length === 0) {
      console.log('No broadcasting or submitted executions require reconciliation.');
    }
  }

  process.exitCode = results.some((item) => item.action === 'error') ? 1 : 0;
}

main().catch((error: unknown) => {
  console.error(
    `Execution reconciliation failed: ${error instanceof Error ? error.message : String(error)}`
  );

  process.exitCode = 2;
});
