import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

const requiredCommands = [
  'bun run typecheck',
  'bun run lint',
  'bun run test',
  'bun run verify:release-surface',
  'bun run verify:audit-findings',
  'bun run verify:release-gates',
  'bun run release:manifest',
  'bun run release:verify',
];

test(
  'verify.yml contains all required CI gate commands',
  async () => {
    const workflowPath = join(
      PROJECT_ROOT,
      '.github/workflows/verify.yml'
    );
    const content = await readFile(
      workflowPath,
      'utf8'
    );

    const missingCommands: string[] = [];

    for (const cmd of requiredCommands) {
      if (!content.includes(cmd)) {
        missingCommands.push(cmd);
      }
    }

    assert.deepEqual(
      missingCommands,
      [],
      `Workflow is missing required commands: ${missingCommands.join(', ')}`
    );
  }
);

test(
  'verify.yml checks out with fetch-depth 0',
  async () => {
    const workflowPath = join(
      PROJECT_ROOT,
      '.github/workflows/verify.yml'
    );
    const content = await readFile(
      workflowPath,
      'utf8'
    );

    assert.ok(
      content.includes('fetch-depth: 0'),
      'Checkout step must use fetch-depth: 0 for manifest generation'
    );
  }
);

test(
  'verify.yml uses actions/checkout@v4',
  async () => {
    const workflowPath = join(
      PROJECT_ROOT,
      '.github/workflows/verify.yml'
    );
    const content = await readFile(
      workflowPath,
      'utf8'
    );

    assert.ok(
      content.includes('actions/checkout@v4'),
      'Must use actions/checkout@v4'
    );
  }
);

test(
  'verify.yml does not use if: always() on any gate step except explicitly allowed',
  async () => {
    const workflowPath = join(
      PROJECT_ROOT,
      '.github/workflows/verify.yml'
    );
    const content = await readFile(
      workflowPath,
      'utf8'
    );

    /*
     * Gates must NOT use `if: always()` because that would
     * allow them to pass even when earlier steps fail.
     * Each gate step should run only if all prior steps passed.
     */
    const lines = content.split('\n');
    const violations: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (
        trimmed.startsWith('- name:') &&
        i + 1 < lines.length
      ) {
        const nextLine = lines[i + 1].trim();

        if (nextLine.includes('if: always()')) {
          violations.push(
            `Step "${trimmed.replace(/^- name:\s*/, '')}" uses if: always() at line ${i + 2}`
          );
        }
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Gate steps must not use if: always(): ${violations.join('; ')}`
    );
  }
);

test(
  'verify.yml generates and verifies release manifest',
  async () => {
    const workflowPath = join(
      PROJECT_ROOT,
      '.github/workflows/verify.yml'
    );
    const content = await readFile(
      workflowPath,
      'utf8'
    );

    assert.ok(
      content.includes('Generate release manifest'),
      'Workflow must have a "Generate release manifest" step'
    );

    assert.ok(
      content.includes('Verify release manifest'),
      'Workflow must have a "Verify release manifest" step'
    );

    assert.ok(
      content.includes('/tmp/release-manifest'),
      'Manifest must be written to a known directory'
    );
  }
);