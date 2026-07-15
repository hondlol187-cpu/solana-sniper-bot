import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readFile,
  readdir,
} from 'node:fs/promises';

import {
  join,
} from 'node:path';

async function listFiles(
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
        ...await listFiles(path)
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

test(
  'production has exactly one raw transaction broadcast call',
  async () => {
    const files =
      await listFiles(
        join(
          process.cwd(),
          'sniper'
        )
      );

    const occurrences:
      string[] = [];

    for (const file of files) {
      const source =
        await readFile(
          file,
          'utf8'
        );

      /*
       * verify-release-surface.ts scans for
       * .sendRawTransaction( as a string literal
       * to detect forbidden call sites. It does
       * not call the method itself. Skip it.
       */
      if (
        file.endsWith(
          'verify-release-surface.ts'
        )
      ) {
        continue;
      }

      if (
        source.includes(
          '.sendRawTransaction('
        )
      ) {
        occurrences.push(
          file
        );
      }
    }

    assert.deepEqual(
      occurrences.map(
        (file) =>
          file.replace(
            `${process.cwd()}/`,
            ''
          )
      ),
      [
        'sniper/verified-execution-rpc.ts',
      ]
    );
  }
);

test(
  'live broadcast path uses persisted artifact and journal',
  async () => {
    const source =
      await readFile(
        join(
          process.cwd(),
          'sniper',
          'verified-execution-core.ts'
        ),
        'utf8'
      );

    assert.match(
      source,
      /loadVerifiedArtifactBytes/
    );

    assert.match(
      source,
      /markExecutionBroadcastReady/
    );

    assert.match(
      source,
      /signVerifiedSimulationTransaction/
    );

    assert.doesNotMatch(
      source,
      /buildSwapTransaction/
    );

    assert.doesNotMatch(
      source,
      /getQuote/
    );
  }
);

test(
  'live execution CLI requires exact plan and artifact confirmation',
  async () => {
    const source =
      await readFile(
        join(
          process.cwd(),
          'sniper',
          'execute-simulated-plan.ts'
        ),
        'utf8'
      );

    assert.match(
      source,
      /CONFIRM:/
    );

    assert.match(
      source,
      /receipt\.artifactId/
    );

    assert.match(
      source,
      /LIVE_TRADING/
    );

    assert.match(
      source,
      /config[\s\S]*keypair/
    );

    assert.match(
      source,
      /executeVerifiedPlan/
    );

    assert.doesNotMatch(
      source,
      /sendRawTransaction/
    );

    assert.doesNotMatch(
      source,
      /PRIVATE_KEY[^_F]/
    );
  }
);
