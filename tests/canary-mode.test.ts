import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readFile,
} from 'node:fs/promises';

import {
  join,
} from 'node:path';

test(
  'config exports canary mode settings',
  async () => {
    const source = await readFile(
      join(process.cwd(), 'sniper', 'config.ts'),
      'utf8'
    );

    assert.match(source, /canaryMode/);
    assert.match(source, /maxCanaryExecutionsPerDay/);
    assert.match(source, /canaryAllowedMints/);
    assert.match(source, /maxCanaryExecutionLamports/);
  }
);

test(
  'canary mode uses CANARY: confirmation prefix',
  async () => {
    const source = await readFile(
      join(process.cwd(), 'sniper', 'execute-simulated-plan.ts'),
      'utf8'
    );

    assert.match(source, /canaryMode/);
    assert.match(source, /'CANARY'/);
    assert.match(source, /'CONFIRM'/);
  }
);

test(
  'verified execution core checks canary limits',
  async () => {
    const source = await readFile(
      join(process.cwd(), 'sniper', 'verified-execution-core.ts'),
      'utf8'
    );

    assert.match(source, /canaryMode/);
    assert.match(source, /maxCanaryExecutionLamports/);
    assert.match(source, /canaryAllowedMints/);
  }
);

test(
  'canary amount limit is lower than live limit by default',
  async () => {
    const source = await readFile(
      join(process.cwd(), 'sniper', 'config.ts'),
      'utf8'
    );

    /*
     * maxCanaryExecutionLamports default is 1_000_000
     * maxLiveExecutionLamports default is 10_000_000
     */
    assert.match(source, /MAX_CANARY_EXECUTION_LAMPORTS[\s\S]*1_000_000/);
    assert.match(source, /MAX_LIVE_EXECUTION_LAMPORTS[\s\S]*10_000_000/);
  }
);
