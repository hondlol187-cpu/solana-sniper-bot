export {};

async function main():
  Promise<void> {
  const [
    confirmation,
  ] = process.argv.slice(2);

  if (
    confirmation !==
      'ACTIVATE-EMERGENCY-STOP'
  ) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:emergency-stop -- ACTIVATE-EMERGENCY-STOP',
        '',
        'This command activates a persistent emergency stop.',
        'The stop file must be removed manually to resume execution.',
      ].join('\n')
    );
  }

  const {
    activateEmergencyStop,
    isEmergencyStopActive,
  } = await import(
    './emergency-stop.js'
  );

  const alreadyActive =
    await isEmergencyStopActive();

  if (alreadyActive) {
    console.log(
      'EMERGENCY STOP ALREADY ACTIVE'
    );

    return;
  }

  await activateEmergencyStop();

  console.log(
    [
      'EMERGENCY STOP ACTIVATED',
      'All verified executions will be blocked.',
      'To resume: manually delete the stop file:',
      '  rm <APPROVED_EXECUTION_PLAN_DIR>/EMERGENCY-STOP',
    ].join('\n')
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      `Emergency stop activation failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 1;
  }
);
