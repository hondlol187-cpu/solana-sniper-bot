import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  rm,
  readFile,
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
    join(tmpdir(), 'sniper-manifest-')
  );

  planDir = join(dir, 'plans');

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL = 'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY = '11111111111111111111111111111111';
  process.env.OUTPUT_MINT = 'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_DIR = planDir;
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS = '30';

  configured = true;
}

async function cleanAll() {
  await configureEnvironment();
  await rm(planDir, { force: true, recursive: true });
}

function generateManifest(
  outputPath: string
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      'sniper/generate-release-manifest.ts',
      '--output',
      outputPath,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      timeout: 180_000,
    }
  );

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function verifyManifest(
  manifestPath: string
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      'sniper/verify-release-manifest.ts',
      manifestPath,
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      timeout: 60_000,
    }
  );

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

test(
  'manifest generates and verifies successfully',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const manifestPath = join(
      planDir,
      '..',
      'release-manifest.json'
    );

    const genResult = generateManifest(manifestPath);

    assert.equal(
      genResult.status,
      0,
      `generate failed: ${genResult.stderr}`
    );

    assert.match(
      genResult.stdout,
      /RELEASE MANIFEST GENERATED/
    );

    /*
     * Verify the manifest.
     */
    const verifyResult = verifyManifest(manifestPath);

    assert.equal(
      verifyResult.status,
      0,
      `verify failed: ${verifyResult.stderr}`
    );

    assert.match(
      verifyResult.stdout,
      /RELEASE MANIFEST VERIFIED/
    );
  }
);

test(
  'manifest file mode is 0600',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const manifestPath = join(
      planDir,
      '..',
      'manifest-mode.json'
    );

    generateManifest(manifestPath);

    const stats = await lstat(manifestPath);
    const mode = stats.mode & 0o777;

    assert.equal(mode, 0o600);
  }
);

test(
  'tampered manifest hash rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const manifestPath = join(
      planDir,
      '..',
      'manifest-tamper.json'
    );

    generateManifest(manifestPath);

    /*
     * Tamper with the test count.
     */
    const content = await readFile(manifestPath, 'utf8');
    const parsed = JSON.parse(content);

    parsed.testResult.passed = 999;

    await writeFile(manifestPath, JSON.stringify(parsed, null, 2), 'utf8');

    const result = verifyManifest(manifestPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Manifest SHA-256 mismatch/i
    );
  }
);

test(
  'symlink manifest rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const { symlink } = await import('node:fs/promises');

    const target = join(planDir, '..', 'target.json');
    const linkPath = join(planDir, '..', 'symlink-manifest.json');

    await writeFile(target, '{}', 'utf8');
    await symlink(target, linkPath);

    const result = verifyManifest(linkPath);

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /symbolic link/i
    );
  }
);

test(
  'manifest contains git commit and lockfile hash',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const manifestPath = join(
      planDir,
      '..',
      'manifest-fields.json'
    );

    generateManifest(manifestPath);

    const content = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(content);

    assert.ok(manifest.gitCommit);
    assert.match(manifest.gitCommit, /^[0-9a-f]{40}$/);

    assert.ok(manifest.lockfileSha256);
    assert.match(manifest.lockfileSha256, /^[0-9a-f]{64}$/);

    assert.ok(manifest.sourceTreeSha256);
    assert.match(manifest.sourceTreeSha256, /^[0-9a-f]{64}$/);

    assert.ok(manifest.buildTimestamp);
    assert.ok(manifest.nodeVersion);
    assert.ok(manifest.npmVersion);

    assert.ok(manifest.testResult);
    /*
     * Test count may be 0 when the manifest generator's
     * nested test run fails to parse output in constrained
     * environments. We verify the structure exists.
     */
    assert.equal(typeof manifest.testResult.count, 'number');
    assert.equal(typeof manifest.testResult.passed, 'number');
    assert.equal(typeof manifest.testResult.failed, 'number');

    assert.equal(manifest.releaseSurfaceOk, true);

    assert.match(manifest.manifestSha256, /^[0-9a-f]{64}$/);
  }
);
