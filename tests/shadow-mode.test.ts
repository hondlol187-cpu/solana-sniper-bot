import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

test(
  'shadow mode loads config from environment',
  async () => {
    process.env.SHADOW_MODE = 'true';
    process.env.SHADOW_REPORT_DIRECTORY = '/tmp/test-shadow';
    process.env.SHADOW_MAX_CANDIDATES_PER_HOUR = '500';
    process.env.SHADOW_REPORT_RETENTION_DAYS = '7';

    try {
      const { loadShadowConfig } = await import('../sniper/shadow-mode.js');
      const config = loadShadowConfig();

      assert.equal(config.enabled, true);
      assert.equal(config.reportDirectory, '/tmp/test-shadow');
      assert.equal(config.maxCandidatesPerHour, 500);
      assert.equal(config.reportRetentionDays, 7);
    } finally {
      delete process.env.SHADOW_MODE;
      delete process.env.SHADOW_REPORT_DIRECTORY;
      delete process.env.SHADOW_MAX_CANDIDATES_PER_HOUR;
      delete process.env.SHADOW_REPORT_RETENTION_DAYS;
    }
  }
);

test(
  'shadow mode disabled by default',
  async () => {
    delete process.env.SHADOW_MODE;

    const { loadShadowConfig } = await import('../sniper/shadow-mode.js');
    const config = loadShadowConfig();

    assert.equal(config.enabled, false);
  }
);

test(
  'forbidden imports list is non-empty',
  async () => {
    const { getForbiddenImports } = await import('../sniper/shadow-mode.js');
    const imports = getForbiddenImports();

    assert.ok(imports.length > 0, 'Must define forbidden imports');
    assert.ok(imports.includes('key-loader'), 'Must forbid key-loader');
    assert.ok(imports.includes('jito-send'), 'Must forbid jito-send');
  }
);

test(
  'forbidden calls list is non-empty',
  async () => {
    const { getForbiddenCalls } = await import('../sniper/shadow-mode.js');
    const calls = getForbiddenCalls();

    assert.ok(calls.length > 0, 'Must define forbidden calls');
    assert.ok(calls.includes('sendRawTransaction'));
    assert.ok(calls.includes('sendJitoBundle'));
  }
);

test(
  'shadow source files do not import forbidden modules',
  async () => {
    const { getForbiddenImports } = await import('../sniper/shadow-mode.js');
    const forbiddenImports = getForbiddenImports();

    const shadowFiles = [
      'sniper/shadow-mode.ts',
      'sniper/shadow-runner.ts',
      'sniper/shadow-report.ts',
    ];

    const violations: string[] = [];

    for (const filePath of shadowFiles) {
      try {
        const content = await readFile(
          join(PROJECT_ROOT, filePath),
          'utf8'
        );

        for (const forbidden of forbiddenImports) {
          if (content.includes(forbidden)) {
            violations.push(`${filePath} imports forbidden module: ${forbidden}`);
          }
        }
      } catch {
        // File doesn't exist yet — skip
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Shadow files must not import forbidden modules: ${violations.join('; ')}`
    );
  }
);

test(
  'shadow source files do not call forbidden functions',
  async () => {
    const { getForbiddenCalls } = await import('../sniper/shadow-mode.js');
    const forbiddenCalls = getForbiddenCalls();

    const shadowFiles = [
      'sniper/shadow-mode.ts',
      'sniper/shadow-runner.ts',
      'sniper/shadow-report.ts',
    ];

    const violations: string[] = [];

    for (const filePath of shadowFiles) {
      try {
        const content = await readFile(
          join(PROJECT_ROOT, filePath),
          'utf8'
        );

        for (const forbidden of forbiddenCalls) {
          if (content.includes(forbidden)) {
            violations.push(`${filePath} calls forbidden function: ${forbidden}`);
          }
        }
      } catch {
        // File doesn't exist yet — skip
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Shadow files must not call forbidden functions: ${violations.join('; ')}`
    );
  }
);