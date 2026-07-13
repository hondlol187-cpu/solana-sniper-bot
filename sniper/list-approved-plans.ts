export {};

interface ListFilters {
  status?:
    | 'prepared'
    | 'simulated'
    | 'cancelled';
  limit?: number;
  mint?: string;
  pool?: string;
}

function parseArgs(
  args: string[]
): {
  jsonMode: boolean;
  filters: ListFilters;
} {
  const jsonMode = args.includes(
    '--json'
  );

  const filters: ListFilters = {};

  const statusIdx = args.indexOf(
    '--status'
  );

  if (statusIdx >= 0) {
    const raw = args[statusIdx + 1];

    if (
      raw === 'prepared' ||
      raw === 'simulated' ||
      raw === 'cancelled'
    ) {
      filters.status = raw;
    } else {
      throw new Error(
        `--status must be prepared|simulated|cancelled, got: ${raw}`
      );
    }
  }

  const limitIdx = args.indexOf(
    '--limit'
  );

  if (limitIdx >= 0) {
    const raw = args[limitIdx + 1];
    const n = Number(raw);

    if (
      !Number.isFinite(n) ||
      n < 1 ||
      !Number.isInteger(n)
    ) {
      throw new Error(
        `--limit must be a positive integer, got: ${raw}`
      );
    }

    filters.limit = n;
  }

  const mintIdx = args.indexOf(
    '--mint'
  );

  if (mintIdx >= 0) {
    filters.mint = args[mintIdx + 1];
  }

  const poolIdx = args.indexOf(
    '--pool'
  );

  if (poolIdx >= 0) {
    filters.pool = args[poolIdx + 1];
  }

  return { jsonMode, filters };
}

function applyFilters(
  valid: import('./execution-plan.js').ApprovedExecutionPlanFile[],
  filters: ListFilters
): import('./execution-plan.js').ApprovedExecutionPlanFile[] {
  let result = valid;

  if (filters.status) {
    result = result.filter(
      (p) =>
        p.state.status ===
        filters.status
    );
  }

  if (filters.mint) {
    result = result.filter(
      (p) =>
        p.payload.exactMint ===
        filters.mint
    );
  }

  if (filters.pool) {
    result = result.filter(
      (p) =>
        p.payload
          .approvedPoolAddress ===
        filters.pool
    );
  }

  if (filters.limit) {
    result = result.slice(
      0,
      filters.limit
    );
  }

  return result;
}

async function main(): Promise<void> {
  process.env.LIVE_TRADING =
    'false';

  const { jsonMode, filters } =
    parseArgs(
      process.argv.slice(2)
    );

  const [
    executionPlanModule,
  ] = await Promise.all([
    import('./execution-plan.js'),
  ]);

  const { valid, invalid } =
    await executionPlanModule
      .scanApprovedExecutionPlans();

  const filtered =
    applyFilters(valid, filters);

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          filters,
          valid: filtered.map(
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
    filtered.length === 0 &&
    invalid.length === 0
  ) {
    console.log(
      'No approved execution plans found.'
    );

    return;
  }

  if (filtered.length > 0) {
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

    const filterDesc: string[] = [];

    if (filters.status)
      filterDesc.push(
        `status=${filters.status}`
      );
    if (filters.mint)
      filterDesc.push(
        `mint=${filters.mint}`
      );
    if (filters.pool)
      filterDesc.push(
        `pool=${filters.pool}`
      );
    if (filters.limit)
      filterDesc.push(
        `limit=${filters.limit}`
      );

    const title =
      filterDesc.length > 0
        ? `Valid plans (${filtered.length}, filtered: ${filterDesc.join(', ')}):`
        : `Valid plans (${filtered.length}):`;

    console.log(title);
    console.log(header);
    console.log(
      '-'.repeat(header.length)
    );

    for (const plan of filtered) {
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
      `\nTotal valid: ${filtered.length} plan${filtered.length === 1 ? '' : 's'}`
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
