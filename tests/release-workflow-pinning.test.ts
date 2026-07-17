import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

test(
  'verify.yml uses actions/checkout@v4 (pinned major version)',
  async () => {
    const workflowPath = join(PROJECT_ROOT, '.github/workflows/verify.yml');
    const content = await readFile(workflowPath, 'utf8');

    assert.ok(
      content.includes('actions/checkout@v4'),
      'Workflow must use pinned actions/checkout@v4'
    );
  }
);

test(
  'verify.yml uses oven-sh/setup-bun@v2 (pinned major version)',
  async () => {
    const workflowPath = join(PROJECT_ROOT, '.github/workflows/verify.yml');
    const content = await readFile(workflowPath, 'utf8');

    assert.ok(
      content.includes('oven-sh/setup-bun@v2'),
      'Workflow must use pinned oven-sh/setup-bun@v2'
    );
  }
);

test(
  'workflow does not use floating action versions',
  async () => {
    const workflowPath = join(PROJECT_ROOT, '.github/workflows/verify.yml');
    const content = await readFile(workflowPath, 'utf8');

    // Check for floating action versions (@main, @latest, @master)
    // Note: @vN pinned major versions (e.g. @v4, @v2) are accepted
    const floatingPatterns = [
      /uses: [^@\n]+@latest/m,
      /uses: [^@\n]+@main/m,
      /uses: [^@\n]+@master/m,
    ];

    const violations: string[] = [];
    for (const pattern of floatingPatterns) {
      const matches = content.match(pattern);
      if (matches) {
        violations.push(...matches);
      }
    }

    assert.deepEqual(
      violations,
      [],
      `Workflow uses floating action versions: ${violations.join(', ')}`
    );
  }
);

test(
  'release provenance module exports required functions',
  async () => {
    const mod = await import('../sniper/release-provenance.js');

    assert.equal(typeof mod.getGitCommit, 'function');
    assert.equal(typeof mod.getGitTag, 'function');
    assert.equal(typeof mod.computeSourceTreeHash, 'function');
    assert.equal(typeof mod.generateProvenance, 'function');
    assert.equal(typeof mod.writeProvenance, 'function');
    assert.equal(typeof mod.verifyProvenance, 'function');
  }
);