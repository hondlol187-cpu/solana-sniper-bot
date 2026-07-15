export {};

import {
  lstat,
  readFile,
} from 'node:fs/promises';

async function main():
  Promise<void> {
  const [
    bundlePath,
    jsonFlag,
  ] = process.argv.slice(2);

  if (!bundlePath) {
    throw new Error(
      [
        'Usage:',
        'npm run sniper:verify-execution-evidence -- ',
        '<BUNDLE_FILE> [--json]',
      ].join('')
    );
  }

  if (
    jsonFlag !== undefined &&
    jsonFlag !== '--json'
  ) {
    throw new Error(
      'Only --json is supported'
    );
  }

  const info =
    await lstat(
      bundlePath
    );

  if (
    info.isSymbolicLink()
  ) {
    throw new Error(
      'Evidence bundle must not be a symbolic link'
    );
  }

  if (!info.isFile()) {
    throw new Error(
      'Evidence bundle is not a regular file'
    );
  }

  if (
    info.size <= 0 ||
    info.size >
      50 * 1024 * 1024
  ) {
    throw new Error(
      'Evidence bundle size is invalid'
    );
  }

  let bundle;

  try {
    bundle =
      JSON.parse(
        await readFile(
          bundlePath,
          'utf8'
        )
      );
  } catch {
    throw new Error(
      'Evidence bundle contains invalid JSON'
    );
  }

  const {
    verifyExecutionEvidenceBundle,
  } = await import(
    './execution-evidence.js'
  );

  const result =
    verifyExecutionEvidenceBundle(
      bundle
    );

  const report = {
    ok: result.ok,

    bundleSha256:
      typeof bundle
        .bundleSha256 ===
        'string'
        ? bundle.bundleSha256
        : null,

    planId:
      bundle
        ?.plan
        ?.planId ??
      null,

    errors:
      result.errors,
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
        result.ok
          ? 'EXECUTION EVIDENCE VALID'
          : 'EXECUTION EVIDENCE INVALID',

        `PlanId: ${report.planId ?? 'unknown'}`,

        `BundleSha256: ${report.bundleSha256 ?? 'unknown'}`,

        `Errors: ${
          result.errors.length
        }`,
      ].join(' | ')
    );

    for (
      const error of
      result.errors
    ) {
      console.error(
        `ERROR: ${error}`
      );
    }
  }

  process.exitCode =
    result.ok
      ? 0
      : 1;
}

main().catch(
  (error: unknown) => {
    console.error(
      `Evidence verification failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 2;
  }
);
