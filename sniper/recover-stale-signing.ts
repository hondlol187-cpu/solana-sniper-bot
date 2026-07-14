export {};

async function main():
  Promise<void> {
  const [
    ageFlag,
    ageValue,
    jsonFlag,
  ] = process.argv.slice(2);

  if (
    ageFlag !==
      '--older-than-seconds' ||
    !ageValue ||
    (
      jsonFlag !== undefined &&
      jsonFlag !== '--json'
    )
  ) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:recover-stale-signing -- ',
        '--older-than-seconds <SECONDS> [--json]',
      ].join('')
    );
  }

  const seconds =
    Number(ageValue);

  if (
    !Number.isSafeInteger(
      seconds
    ) ||
    seconds < 60 ||
    seconds > 86_400
  ) {
    throw new Error(
      'Seconds must be an integer between 60 and 86400'
    );
  }

  const journalModule =
    await import(
      './execution-journal.js'
    );

  const auditModule =
    await import(
      './execution-audit.js'
    );

  const journals =
    await journalModule
      .listExecutionJournals();

  const results:
    Array<{
      executionId: string;
      previousStatus: string;
      currentStatus: string;
      result:
        'failed' |
        'skipped' |
        'error';
      error?: string;
    }> = [];

  const minimumAgeMs =
    seconds *
    1_000;

  for (const journal of journals) {
    if (
      journal.status !==
      'signing'
    ) {
      continue;
    }

    try {
      const updated =
        await journalModule
          .failStaleSigningExecution(
            journal.executionId,
            minimumAgeMs
          );

      await auditModule.auditExecutionFailed(
        updated
      );

      results.push({
        executionId:
          journal.executionId,

        previousStatus:
          journal.status,

        currentStatus:
          updated.status,

        result: 'failed',
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      if (
        /not stale/i.test(
          message
        )
      ) {
        results.push({
          executionId:
            journal.executionId,

          previousStatus:
            journal.status,

          currentStatus:
            journal.status,

          result: 'skipped',
        });
      } else {
        results.push({
          executionId:
            journal.executionId,

          previousStatus:
            journal.status,

          currentStatus:
            journal.status,

          result: 'error',

          error: message,
        });
      }
    }
  }

  const report = {
    checked:
      results.length,

    failed:
      results.filter(
        (item) =>
          item.result ===
          'failed'
      ).length,

    skipped:
      results.filter(
        (item) =>
          item.result ===
          'skipped'
      ).length,

    errors:
      results.filter(
        (item) =>
          item.result ===
          'error'
      ).length,

    results,
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
        'STALE SIGNING RECOVERY',
        `Checked: ${report.checked}`,
        `Failed: ${report.failed}`,
        `Skipped: ${report.skipped}`,
        `Errors: ${report.errors}`,
      ].join(' | ')
    );
  }

  process.exitCode =
    report.errors > 0
      ? 1
      : 0;
}

main().catch(
  (error: unknown) => {
    console.error(
      `Signing recovery failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 2;
  }
);
