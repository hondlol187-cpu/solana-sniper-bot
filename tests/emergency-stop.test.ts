import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  lstat,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnSync } from 'node:child_process';

let configured = false;
let planDir: string;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-emergency-')
  );

  planDir = join(dir, 'plans');

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL = 'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY = '11111111111111111111111111111111';
  process.env.OUTPUT_MINT = 'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_DIR = planDir;

  configured = true;
}

async function cleanAll() {
  await configureEnvironment();
  await rm(planDir, { force: true, recursive: true });
  await mkdir(planDir, { recursive: true, mode: 0o700 });
}

test(
  'emergency stop activates and blocks',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { activateEmergencyStop, isEmergencyStopActive,
      assertEmergencyStopNotActive } = await import(
      '../sniper/emergency-stop.js'
    );

    assert.equal(await isEmergencyStopActive(), false);

    await activateEmergencyStop();

    assert.equal(await isEmergencyStopActive(), true);

    await assert.rejects(
      assertEmergencyStopNotActive('test-checkpoint'),
      /Emergency stop is active/i
    );
  }
);

test(
  'emergency stop file is 0600',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { activateEmergencyStop } = await import(
      '../sniper/emergency-stop.js'
    );

    await activateEmergencyStop();

    const stats = await lstat(
      join(planDir, 'EMERGENCY-STOP')
    );

    const mode = stats.mode & 0o777;

    assert.equal(mode, 0o600);
  }
);

test(
  'emergency stop CLI requires exact confirmation',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        'sniper/emergency-stop-cli.ts',
        'WRONG',
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
      }
    );

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /ACTIVATE-EMERGENCY-STOP/i
    );
  }
);

test(
  'emergency stop CLI activates with correct confirmation',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
        'sniper/emergency-stop-cli.ts',
        'ACTIVATE-EMERGENCY-STOP',
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        encoding: 'utf8',
      }
    );

    assert.equal(result.status, 0);
    assert.match(
      result.stdout,
      /EMERGENCY STOP ACTIVATED/i
    );
  }
);

test(
  'canary config limits exist',
  async () => {
    const source = await import(
      'node:fs/promises'
    ).then((fs) =>
      fs.readFile(
        join(process.cwd(), 'sniper', 'config.ts'),
        'utf8'
      )
    );

    assert.match(source, /maxCanaryExecutionLamports/);
    assert.match(source, /maxConcurrentLiveExecutions/);
  }
);

test(
  'verified execution core checks emergency stop before each boundary',
  async () => {
    const source = await import(
      'node:fs/promises'
    ).then((fs) =>
      fs.readFile(
        join(process.cwd(), 'sniper', 'verified-execution-core.ts'),
        'utf8'
      )
    );

    const checks = source.match(
      /assertEmergencyStopNotActive\(/g
    );

    assert.ok(checks);
    assert.ok(
      checks.length >= 4,
      `expected >= 4 emergency stop checks, got ${checks.length}`
    );
  }
);
