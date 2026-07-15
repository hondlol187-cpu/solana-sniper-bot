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
      '--older-than-days' ||
    !ageValue ||
    (
      jsonFlag !== undefined &&
      jsonFlag !== '--json'
    )
  ) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:plan-execution-retention -- ',
        '--older-than-days <DAYS> [--json]',
      ].join('')
    );
  }

  const days =
    Number(ageValue);

  if (
    !Number.isSafeInteger(
      days
    ) ||
    days < 1 ||
    days > 3_650
  ) {
    throw new Error(
      'Days must be an integer between 1 and 3650'
    );
  }

  const {
    listExecutionRetentionCandidates,
  } = await import(
    './execution-retention.js'
  );

  const candidates =
    await listExecutionRetentionCandidates(
      days *
        24 *
        60 *
        60 *
        1_000
    );

  const report = {
    dryRun: true,
    olderThanDays: days,
    candidateCount:
      candidates.length,
    candidates,
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
        'EXECUTION RETENTION DRY RUN',
        `OlderThanDays: ${days}`,
        `Candidates: ${candidates.length}`,
        'No files were modified.',
      ].join(' | ')
    );

    for (
      const candidate of
      candidates
    ) {
      console.log(
        [
          `PlanId: ${candidate.planId}`,
          `Outcome: ${candidate.outcome}`,
          `AgeMs: ${candidate.ageMs}`,
          `ArtifactId: ${candidate.artifactId}`,
        ].join(' | ')
      );
    }
  }
}

main().catch(
  (error: unknown) => {
    console.error(
      `Retention planning failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 1;
  }
);
