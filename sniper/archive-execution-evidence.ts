export {};

async function main():
  Promise<void> {
  const [
    planId,
    confirmation,
  ] = process.argv.slice(2);

  if (!planId) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:archive-execution-evidence -- ',
        '<PLAN_ID> ARCHIVE:<PLAN_ID>',
      ].join('')
    );
  }

  if (
    confirmation !==
    `ARCHIVE:${planId}`
  ) {
    throw new Error(
      `Exact confirmation required: ARCHIVE:${planId}`
    );
  }

  const {
    archiveExecutionEvidence,
  } = await import(
    './execution-archive.js'
  );

  const archive =
    await archiveExecutionEvidence(
      planId
    );

  console.log(
    [
      'EXECUTION EVIDENCE ARCHIVED',
      `PlanId: ${archive.planId}`,
      `PlanInstanceId: ${archive.planInstanceId}`,
      `BundleSha256: ${archive.evidenceBundle.bundleSha256}`,
      `ArchiveSha256: ${archive.archiveSha256}`,
      'Original files were not deleted.',
    ].join(' | ')
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      `Execution archive failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 1;
  }
);
