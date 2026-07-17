import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const SHADOW_FILES = [
  'sniper/shadow-mode.ts',
  'sniper/shadow-runner.ts',
  'sniper/shadow-report.ts',
  'sniper/run-shadow-mode.ts',
];

const FORBIDDEN_IMPORTS = ['key-loader', 'jito-send', 'verified-transaction'];
const FORBIDDEN_CALLS = [
  'sendRawTransaction',
  'sendTransaction',
  'signTransaction',
  'signAllTransactions',
  'sendBundle',
];

test(
  'shadow files do not import forbidden modules',
  async () => {
    const violations: string[] = [];

    for (const filePath of SHADOW_FILES) {
      try {
        const content = await readFile(join(PROJECT_ROOT, filePath), 'utf8');
        for (const forbidden of FORBIDDEN_IMPORTS) {
          if (content.includes(forbidden)) {
            violations.push(`${filePath} imports ${forbidden}`);
          }
        }
      } catch { /* file may not exist */ }
    }

    assert.deepEqual(violations, [], `Violations: ${violations.join('; ')}`);
  }
);

test(
  'shadow files do not call forbidden functions',
  async () => {
    const violations: string[] = [];

    for (const filePath of SHADOW_FILES) {
      try {
        const content = await readFile(join(PROJECT_ROOT, filePath), 'utf8');
        for (const forbidden of FORBIDDEN_CALLS) {
          if (content.includes(forbidden)) {
            violations.push(`${filePath} calls ${forbidden}`);
          }
        }
      } catch { /* file may not exist */ }
    }

    assert.deepEqual(violations, [], `Violations: ${violations.join('; ')}`);
  }
);