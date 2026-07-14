import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readFile,
  readdir,
} from 'node:fs/promises';

import {
  join,
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

  const files: string[] = [];

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

      continue;
    }

    if (
      entry.isFile() &&
      entry.name.endsWith('.ts')
    ) {
      files.push(path);
    }
  }

  return files;
}

test(
  'production has no legacy simulation transition APIs',
  async () => {
    const sniperDirectory =
      join(
        process.cwd(),
        'sniper'
      );

    const files =
      await listTypeScriptFiles(
        sniperDirectory
      );

    const forbidden = [
      'commitSimulationReceipt',
      'markApprovedExecutionPlanSimulated',
    ];

    for (const file of files) {
      const source =
        await readFile(
          file,
          'utf8'
        );

      for (
        const symbol of
        forbidden
      ) {
        assert.equal(
          source.includes(symbol),
          false,
          `${symbol} remains in ${file}`
        );
      }
    }
  }
);

test(
  'production has exactly one simulated-state write',
  async () => {
    const sniperDirectory =
      join(
        process.cwd(),
        'sniper'
      );

    const files =
      await listTypeScriptFiles(
        sniperDirectory
      );

    const occurrences:
      Array<{
        file: string;
        count: number;
      }> = [];

    let total = 0;

    for (const file of files) {
      const source =
        await readFile(
          file,
          'utf8'
        );

      const matches =
        source.match(
          /status\s*:\s*['"]simulated['"]/g
        ) ?? [];

      if (matches.length > 0) {
        occurrences.push({
          file,
          count:
            matches.length,
        });
      }

      total += matches.length;
    }

    assert.equal(
      total,
      1,
      [
        'Expected exactly one production simulated-state write.',
        JSON.stringify(
          occurrences
        ),
      ].join(' ')
    );

    assert.match(
      occurrences[0]?.file ?? '',
      /execution-plan\.ts$/
    );
  }
);

test(
  'approved-plan CLI uses trusted artifact commit',
  async () => {
    const path =
      join(
        process.cwd(),
        'sniper',
        'simulate-approved-plan.ts'
      );

    const source =
      await readFile(
        path,
        'utf8'
      );

    assert.match(
      source,
      /commitSimulationArtifact/
    );

    assert.doesNotMatch(
      source,
      /commitSimulationReceipt/
    );

    assert.doesNotMatch(
      source,
      /markApprovedExecutionPlanSimulated/
    );
  }
);
