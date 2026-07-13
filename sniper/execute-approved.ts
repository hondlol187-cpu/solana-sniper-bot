export {};

async function main(): Promise<void> {
  const [
    signature,
    exactMint,
    mode = '--dry-run',
  ] = process.argv.slice(2);

  if (!signature || !exactMint) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:execute-approved -- <signature> <exact-mint> --dry-run',
        'npm run sniper:execute-approved -- <signature> <exact-mint> --live',
      ].join('\n')
    );
  }

  if (
    mode !== '--dry-run' &&
    mode !== '--live'
  ) {
    throw new Error(
      'Mode must be --dry-run or --live'
    );
  }

  if (mode === '--live') {
    throw new Error(
      [
        'Live execution of approved candidates is intentionally disabled.',
        'Use prepare-approved and simulate-approved-plan for the safe path.',
      ].join(' ')
    );
  }

  const { spawnSync } =
    await import('node:child_process');

  const prepare = spawnSync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      'sniper/prepare-approved.ts',
      signature,
      exactMint,
    ],
    {
      env: process.env,
      encoding: 'utf8',
    }
  );

  if (prepare.stdout) {
    process.stdout.write(
      prepare.stdout
    );
  }

  if (prepare.stderr) {
    process.stderr.write(
      prepare.stderr
    );
  }

  if (prepare.status !== 0) {
    process.exitCode =
      prepare.status ?? 1;
    return;
  }

  const planIdMatch =
    prepare.stdout?.match(
      /PLAN_ID=([A-Za-z0-9_-]+)/
    );

  if (!planIdMatch) {
    throw new Error(
      'prepare-approved did not return a plan ID'
    );
  }

  const planId =
    planIdMatch[1];

  const simulate = spawnSync(
    process.execPath,
    [
      'node_modules/tsx/dist/cli.mjs',
      'sniper/simulate-approved-plan.ts',
      planId,
    ],
    {
      stdio: 'inherit',
      env: process.env,
    }
  );

  process.exitCode =
    simulate.status ?? 1;
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    `Approved execution failed: ${message}`
  );

  process.exitCode = 1;
});
