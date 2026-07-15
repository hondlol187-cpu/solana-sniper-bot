export {};

import {
  readFile,
  readdir,
} from 'node:fs/promises';

import {
  join,
  relative,
} from 'node:path';

async function listTypeScriptFiles(
  directory: string
): Promise<string[]> {
  const entries =
    await readdir(
      directory,
      {
        withFileTypes: true,
      }
    );

  const files: string[] =
    [];

  for (const entry of entries) {
    const path =
      join(
        directory,
        entry.name
      );

    if (entry.isDirectory()) {
      files.push(
        ...await listTypeScriptFiles(
          path
        )
      );
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts')
    ) {
      files.push(path);
    }
  }

  return files;
}

async function main():
  Promise<void> {
  const root =
    process.cwd();

  const sniperDirectory =
    join(root, 'sniper');

  const files =
    await listTypeScriptFiles(
      sniperDirectory
    );

  const sendCallSites:
    string[] = [];

  const privateKeyReaders:
    string[] = [];

  const forbiddenLegacySymbols = [
    'commitSimulationReceipt',
    'markApprovedExecutionPlanSimulated',
  ];

  const errors: string[] =
    [];

  for (const file of files) {
    const source =
      await readFile(
        file,
        'utf8'
      );

    const displayPath =
      relative(root, file);

    /*
     * This file itself scans for forbidden patterns.
     * Skip it to avoid self-flagging.
     */
    if (
      displayPath ===
        'sniper/verify-release-surface.ts'
    ) {
      continue;
    }

    if (
      source.includes(
        '.sendRawTransaction('
      )
    ) {
      sendCallSites.push(
        displayPath
      );
    }

    if (
      source.includes(
        'process.env.PRIVATE_KEY'
      )
    ) {
      privateKeyReaders.push(
        displayPath
      );
    }

    for (
      const symbol of
      forbiddenLegacySymbols
    ) {
      if (
        source.includes(symbol)
      ) {
        errors.push(
          `${symbol} remains in ${displayPath}`
        );
      }
    }
  }

  if (
    sendCallSites.length !== 1 ||
    sendCallSites[0] !==
      'sniper/verified-execution-rpc.ts'
  ) {
    errors.push(
      `Unexpected broadcast surfaces: ${JSON.stringify(
        sendCallSites
      )}`
    );
  }

  const allowedPrivateKeyReaders =
    new Set([
      'sniper/config.ts',
    ]);

  for (
    const reader of
    privateKeyReaders
  ) {
    if (
      !allowedPrivateKeyReaders.has(
        reader
      )
    ) {
      errors.push(
        `Unexpected private-key environment read in ${reader}`
      );
    }
  }

  const requiredFiles = [
    'sniper/verified-execution-core.ts',
    'sniper/verified-execution-rpc.ts',
    'sniper/execution-journal.ts',
    'sniper/execution-settlement.ts',
    'sniper/execution-evidence.ts',
    'sniper/release-readiness.ts',
  ];

  for (
    const requiredFile of
    requiredFiles
  ) {
    try {
      await readFile(
        join(root, requiredFile),
        'utf8'
      );
    } catch {
      errors.push(
        `Required release file is missing: ${requiredFile}`
      );
    }
  }

  if (
    errors.length > 0
  ) {
    for (const error of errors) {
      console.error(
        `ERROR: ${error}`
      );
    }

    process.exitCode = 1;
    return;
  }

  console.log(
    'RELEASE SURFACE VERIFIED'
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : String(error)
    );

    process.exitCode = 2;
  }
);
