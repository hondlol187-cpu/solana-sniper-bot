export {};

import {
  chmod,
  rename,
  writeFile,
} from 'node:fs/promises';

import {
  randomUUID,
} from 'node:crypto';

async function main():
  Promise<void> {
  const [
    planId,
    outputFlag,
    outputPath,
  ] = process.argv.slice(2);

  if (
    !planId ||
    outputFlag !==
      '--output' ||
    !outputPath
  ) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:export-execution-evidence -- ',
        '<PLAN_ID> --output <FILE>',
      ].join('')
    );
  }

  const {
    buildExecutionEvidenceBundle,
    verifyExecutionEvidenceBundle,
  } = await import(
    './execution-evidence.js'
  );

  const bundle =
    await buildExecutionEvidenceBundle(
      planId
    );

  const verification =
    verifyExecutionEvidenceBundle(
      bundle
    );

  if (!verification.ok) {
    throw new Error(
      `Evidence bundle verification failed: ${verification.errors.join('; ')}`
    );
  }

  const temporaryPath =
    `${outputPath}.${randomUUID()}.tmp`;

  await writeFile(
    temporaryPath,
    JSON.stringify(
      bundle,
      null,
      2
    ),
    {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    }
  );

  await rename(
    temporaryPath,
    outputPath
  );

  await chmod(
    outputPath,
    0o600
  );

  console.log(
    [
      'EXECUTION EVIDENCE EXPORTED',
      `PlanId: ${planId}`,
      `BundleSha256: ${bundle.bundleSha256}`,
      `Output: ${outputPath}`,
    ].join(' | ')
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      `Evidence export failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 1;
  }
);
