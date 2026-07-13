export {};

async function main(): Promise<void> {
  process.env.LIVE_TRADING =
    'false';

  const args =
    process.argv.slice(2);

  const jsonMode = args.includes(
    '--json'
  );

  const [
    executionPlanModule,
  ] = await Promise.all([
    import('./execution-plan.js'),
  ]);

  const { valid, invalid } =
    await executionPlanModule
      .scanApprovedExecutionPlans();

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          valid: valid.map(
            (plan) => ({
              planId: plan.planId,
              version: plan.version,
              diskVersion:
                plan.diskVersion,
              sha256: plan.sha256,
              status:
                plan.state.status,
              simulationCount:
                plan.state
                  .simulationCount,
              createdAt:
                plan.payload
                  .createdAt,
              simulatedAt:
                plan.state
                  .simulatedAt ??
                null,
              cancelledAt:
                plan.state
                  .cancelledAt ??
                null,
              exactMint:
                plan.payload
                  .exactMint,
              approvedPoolAddress:
                plan.payload
                  .approvedPoolAddress,
            })
          ),
          invalid,
        },
        null,
        2
      )
    );

    return;
  }

  if (
    valid.length === 0 &&
    invalid.length === 0
  ) {
    console.log(
      'No approved execution plans found.'
    );

    return;
  }

  if (valid.length > 0) {
    const trunc = (
      value: string,
      len: number
    ): string =>
      value.length > len
        ? `${value.slice(0, len)}…`
        : value.padEnd(len);

    const header = [
      'PLAN_ID'.padEnd(48),
      'STATUS'.padEnd(12),
      'CREATED_AT'.padEnd(26),
      'SIMULATED_AT'.padEnd(26),
      'MINT'.padEnd(14),
      'POOL'.padEnd(14),
      'SIMS',
    ].join(' ');

    console.log(
      `Valid plans (${valid.length}):`
    );
    console.log(header);
    console.log(
      '-'.repeat(header.length)
    );

    for (const plan of valid) {
      const state = plan.state;
      const payload = plan.payload;

      console.log(
        [
          trunc(plan.planId, 48),
          state.status.padEnd(12),
          trunc(
            payload.createdAt,
            26
          ),
          trunc(
            state.simulatedAt ??
              '-',
            26
          ),
          trunc(payload.exactMint, 14),
          trunc(
            payload.approvedPoolAddress,
            14
          ),
          String(
            state.simulationCount
          ),
        ].join(' ')
      );
    }

    console.log(
      `\nTotal valid: ${valid.length} plan${valid.length === 1 ? '' : 's'}`
    );
  }

  if (invalid.length > 0) {
    console.log(
      `\nInvalid plans (${invalid.length}):`
    );

    for (const inv of invalid) {
      console.log(
        [
          `  ${inv.planId}`,
          `error: ${inv.error}`,
        ].join(' | ')
      );
    }

    console.log(
      `\nTotal invalid: ${invalid.length} plan${invalid.length === 1 ? '' : 's'}`
    );
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `List approved plans failed: ${message}`
  );

  process.exitCode = 1;
});
