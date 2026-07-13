export {};

async function main(): Promise<void> {
  process.env.LIVE_TRADING =
    'false';

  const args =
    process.argv.slice(2);

  const jsonMode = args.includes(
    '--json'
  );

  const { verifyPlanRetentionLedger } =
    await import(
      './plan-audit.js'
    );

  const result =
    await verifyPlanRetentionLedger();

  if (jsonMode) {
    console.log(
      JSON.stringify(result, null, 2)
    );
  } else {
    console.log(
      '=== RETENTION LEDGER VERIFICATION ==='
    );

    console.log(
      `Entries: ${result.entryCount}`
    );

    console.log(
      `OK: ${result.ok}`
    );

    if (result.errors.length > 0) {
      console.log(
        `\n--- Errors (${result.errors.length}) ---`
      );

      for (const error of result.errors) {
        console.log(`  ${error}`);
      }
    }
  }

  /*
   * Exit codes:
   *   0 = chain valid
   *   1 = malformed entry (hash mismatch)
   *   2 = hash-chain failure (previousHash link broken)
   *   3 = sequence gap
   */
  if (!result.ok) {
    const hasHashMismatch =
      result.errors.some((e) =>
        e.includes('entryHash mismatch')
      );

    const hasChainFailure =
      result.errors.some((e) =>
        e.includes('previousHash mismatch')
      );

    const hasSequenceGap =
      result.errors.some((e) =>
        e.includes('sequence gap')
      );

    if (hasHashMismatch) {
      process.exitCode = 1;
    } else if (hasChainFailure) {
      process.exitCode = 2;
    } else if (hasSequenceGap) {
      process.exitCode = 3;
    } else {
      process.exitCode = 1;
    }
  }
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `Verify plan history failed: ${message}`
  );

  process.exitCode = 1;
});
