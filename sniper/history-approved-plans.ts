export {};

async function main(): Promise<void> {
  process.env.LIVE_TRADING =
    'false';

  const args =
    process.argv.slice(2);

  const jsonMode = args.includes(
    '--json'
  );

  const limitIdx = args.indexOf(
    '--limit'
  );

  let limit: number | undefined;

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

    limit = n;
  }

  const planIdIdx = args.indexOf(
    '--plan-id'
  );

  let planIdFilter: string | undefined;

  if (planIdIdx >= 0) {
    planIdFilter =
      args[planIdIdx + 1];
  }

  const [
    planAuditModule,
  ] = await Promise.all([
    import('./plan-audit.js'),
  ]);

  let tombstones =
    await planAuditModule.readPlanTombstones();

  /*
   * Filter by planId if requested.
   */
  if (planIdFilter) {
    tombstones = tombstones.filter(
      (t) => t.planId === planIdFilter
    );
  }

  /*
   * Tombstones are append-only, so the most recent
   * are at the end. Reverse for "most recent first"
   * display, then apply the limit.
   */
  tombstones.reverse();

  if (limit) {
    tombstones = tombstones.slice(
      0,
      limit
    );
  }

  if (jsonMode) {
    console.log(
      JSON.stringify(
        {
          count: tombstones.length,
          tombstones,
        },
        null,
        2
      )
    );

    return;
  }

  if (tombstones.length === 0) {
    console.log(
      'No plan tombstones found.'
    );

    return;
  }

  console.log(
    `=== PLAN HISTORY (${tombstones.length}) ===\n`
  );

  for (const t of tombstones) {
    console.log(
      [
        `PlanId: ${t.planId}`,
        `FinalStatus: ${t.finalStatus}`,
        `DeletedAt: ${t.deletedAt}`,
        `DeleteReason: ${t.deleteReason}`,
        t.sha256
          ? `Sha256: ${t.sha256}`
          : '',
        t.version !== undefined
          ? `Version: ${t.version}`
          : '',
        t.walletPublicKey
          ? `Wallet: ${t.walletPublicKey}`
          : '',
        t.expectedCluster
          ? `Cluster: ${t.expectedCluster}`
          : '',
      ]
        .filter(Boolean)
        .join(' | ')
    );
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `History approved plans failed: ${message}`
  );

  process.exitCode = 1;
});
