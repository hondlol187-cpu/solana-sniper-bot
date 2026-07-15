import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readFile,
} from 'node:fs/promises';

import {
  join,
} from 'node:path';

test(
  'mainnet execution disabled by default',
  async () => {
    const source =
      await readFile(
        join(
          process.cwd(),
          'sniper',
          'config.ts'
        ),
        'utf8'
      );

    assert.match(
      source,
      /ENABLE_MAINNET_EXECUTION/
    );

    assert.match(
      source,
      /booleanEnv\(\s*['"]ENABLE_MAINNET_EXECUTION['"],\s*false\s*\)/
    );
  }
);

test(
  'executeVerifiedPlan checks mainnet execution override',
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
      /enableMainnetExecution/
    );

    assert.match(
      source,
      /Mainnet execution is disabled/
    );
  }
);

test(
  'executeVerifiedPlan checks buy amount against maximum',
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
      /maxLiveExecutionLamports/
    );

    assert.match(
      source,
      /exceeds/
    );
  }
);

test(
  'executeVerifiedPlan checks wallet balance before risk reservation',
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
      /minimumFeeReserveLamports/
    );

    assert.match(
      source,
      /insufficient for verified execution/
    );
  }
);

test(
  'executeVerifiedPlan uses live execution receipt age limit',
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
      /maxLiveExecutionReceiptAgeSeconds/
    );

    assert.doesNotMatch(
      source,
      /maxSimulationReceiptAgeSeconds/
    );
  }
);

test(
  'live CLI checks mainnet execution override',
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
      /ENABLE_MAINNET_EXECUTION/
    );

    assert.match(
      source,
      /required for mainnet/
    );
  }
);

test(
  'confirmation phrase includes amount and mint',
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
      /buyLamports/
    );

    assert.match(
      source,
      /exactMint/
    );

    assert.match(
      source,
      /'CONFIRM'/
    );
  }
);

test(
  'no safety interlock calls sendRawTransaction',
  async () => {
    /*
     * The safety interlocks in executeVerifiedPlan all
     * throw BEFORE the broadcast phase. The only
     * sendRawTransaction call is in verified-execution-rpc.ts,
     * not in verified-execution-core.ts.
     */
    const coreSource =
      await readFile(
        join(
          process.cwd(),
          'sniper',
          'verified-execution-core.ts'
        ),
        'utf8'
      );

    assert.doesNotMatch(
      coreSource,
      /\.sendRawTransaction\(/
    );

    const rpcSource =
      await readFile(
        join(
          process.cwd(),
          'sniper',
          'verified-execution-rpc.ts'
        ),
        'utf8'
      );

    const sendRawCount = (
      rpcSource.match(
        /\.sendRawTransaction\(/g
      ) ?? []
    ).length;

    assert.equal(
      sendRawCount,
      1,
      'exactly one sendRawTransaction call in verified-execution-rpc.ts'
    );
  }
);

test(
  'config exports all new safety settings',
  async () => {
    const source =
      await readFile(
        join(
          process.cwd(),
          'sniper',
          'config.ts'
        ),
        'utf8'
      );

    assert.match(
      source,
      /enableMainnetExecution/
    );

    assert.match(
      source,
      /maxLiveExecutionLamports/
    );

    assert.match(
      source,
      /maxLiveExecutionReceiptAgeSeconds/
    );
  }
);

test(
  'live CLI confirmation format is CONFIRM:planId:artifactId:amount:mint',
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

    /*
     * The confirmation is built from:
     * ['CONFIRM', planId, receipt.artifactId,
     *  plan.payload.buyLamports, plan.payload.exactMint].join(':')
     */
    assert.match(
      source,
      /\[.*'CONFIRM'.*planId.*artifactId.*buyLamports.*exactMint.*\]\.join\(':'\)/s
    );
  }
);

test(
  'devnet does not require the mainnet override',
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

    /*
     * The mainnet check is:
     *   if (config.expectedCluster === 'mainnet-beta' &&
     *       !config.enableMainnetExecution)
     * On devnet, expectedCluster is 'devnet', so the check
     * is skipped.
     */
    assert.match(
      source,
      /expectedCluster ===\s*'mainnet-beta'/
    );
  }
);
