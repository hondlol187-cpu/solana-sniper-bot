export {};

async function main(): Promise<void> {
  process.env.LIVE_TRADING =
    'false';

  const [
    executionPlanModule,
  ] = await Promise.all([
    import('./execution-plan.js'),
  ]);

  const plans =
    await executionPlanModule.listApprovedExecutionPlans();

  if (plans.length === 0) {
    console.log(
      'No approved execution plans found.'
    );

    return;
  }

  /*
   * Tabular output with fixed-width columns.
   * Truncate long mint/pool addresses to 12 chars
   * (matching the planId prefix convention).
   */
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

  console.log(header);
  console.log(
    '-'.repeat(header.length)
  );

  for (const plan of plans) {
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
    `\nTotal: ${plans.length} plan${plans.length === 1 ? '' : 's'}`
  );
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
