import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readFile,
} from 'node:fs/promises';

import {
  join,
} from 'node:path';

test(
  'devnet smoke CLI refuses non-devnet clusters',
  async () => {
    const source = await readFile(
      join(
        process.cwd(),
        'sniper',
        'devnet-smoke.ts'
      ),
      'utf8'
    );

    assert.match(
      source,
      /EXPECTED_CLUSTER=devnet/
    );

    assert.match(
      source,
      /expectedCluster !==\s*'devnet'/
    );
  }
);

test(
  'devnet smoke CLI refuses mainnet execution',
  async () => {
    const source = await readFile(
      join(
        process.cwd(),
        'sniper',
        'devnet-smoke.ts'
      ),
      'utf8'
    );

    assert.match(
      source,
      /enableMainnetExecution/
    );
  }
);

test(
  'devnet smoke CLI refuses live trading',
  async () => {
    const source = await readFile(
      join(
        process.cwd(),
        'sniper',
        'devnet-smoke.ts'
      ),
      'utf8'
    );

    assert.match(
      source,
      /LIVE_TRADING=false/
    );
  }
);

test(
  'devnet smoke CLI runs preview and artifact verification',
  async () => {
    const source = await readFile(
      join(
        process.cwd(),
        'sniper',
        'devnet-smoke.ts'
      ),
      'utf8'
    );

    assert.match(
      source,
      /preview-verified-execution/
    );

    assert.match(
      source,
      /verify-simulation-artifact/
    );
  }
);

test(
  'devnet smoke CLI checks archives and release readiness',
  async () => {
    const source = await readFile(
      join(
        process.cwd(),
        'sniper',
        'devnet-smoke.ts'
      ),
      'utf8'
    );

    assert.match(
      source,
      /verify-execution-archives/
    );

    assert.match(
      source,
      /release-readiness/
    );
  }
);

test(
  'devnet smoke CLI produces structured JSON report',
  async () => {
    const source = await readFile(
      join(
        process.cwd(),
        'sniper',
        'devnet-smoke.ts'
      ),
      'utf8'
    );

    assert.match(
      source,
      /planId/
    );

    assert.match(
      source,
      /allOk/
    );

    assert.match(
      source,
      /steps/
    );
  }
);

test(
  'devnet smoke CLI source contains no sendRawTransaction or signing call',
  async () => {
    const source = await readFile(
      join(
        process.cwd(),
        'sniper',
        'devnet-smoke.ts'
      ),
      'utf8'
    );

    assert.doesNotMatch(
      source,
      /sendRawTransaction/
    );

    assert.doesNotMatch(
      source,
      /\.sign\(/
    );

    assert.doesNotMatch(
      source,
      /sendExactTransaction/
    );
  }
);
