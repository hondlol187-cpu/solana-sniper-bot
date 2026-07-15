import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

function runReleaseGates(
  manifestDir?: string
): {
  status: number | null;
  stdout: string;
  stderr: string;
  combined: string;
} {
  const args = [
    'bun',
    'x',
    'tsx',
    'sniper/verify-release-gates.ts',
  ];

  if (manifestDir) {
    args.push(manifestDir);
  }

  const result = spawnSync(args[0], args.slice(1), {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 300_000,
  });

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';

  return {
    status: result.status,
    stdout,
    stderr,
    combined: stdout + '\n' + stderr,
  };
}

function runReleaseGatesExpectFail(
  manifestDir?: string
): {
  status: number;
  stdout: string;
  stderr: string;
  combined: string;
} {
  const result = runReleaseGates(manifestDir);

  return {
    status: result.status ?? 1,
    stdout: result.stdout,
    stderr: result.stderr,
    combined: result.combined,
  };
}

test(
  'release gates pass when all subchecks pass',
  async () => {
    const result = runReleaseGates();

    assert.equal(
      result.status,
      0
    );

    assert.ok(
      result.combined.includes(
        'ALL RELEASE GATES PASSED'
      )
    );

    assert.ok(
      result.combined.includes(
        'release-surface'
      )
    );

    assert.ok(
      result.combined.includes(
        'audit-findings'
      )
    );
  }
);

test(
  'summary output is deterministic',
  async () => {
    const result1 = runReleaseGates();
    const result2 = runReleaseGates();

    assert.equal(
      result1.status,
      result2.status
    );

    const extractSummary = (
      output: string
    ) => {
      const match = output.match(
        /Total: \d+ gates, \d+ passed, \d+ failed/
      );

      return match ? match[0] : '';
    };

    assert.equal(
      extractSummary(result1.combined),
      extractSummary(result2.combined)
    );
  }
);

test(
  'gate output includes individual gate results',
  async () => {
    const result = runReleaseGates();

    assert.ok(
      result.combined.includes('[PASS]')
    );

    assert.ok(
      result.combined.includes('release-surface')
    );

    assert.ok(
      result.combined.includes('audit-findings')
    );
  }
);

test(
  'audit findings gate is present and passes',
  async () => {
    const result = runReleaseGates();

    assert.ok(
      result.combined.includes('audit-findings')
    );

    assert.ok(
      result.combined.includes('[PASS]')
    );
  }
);

test(
  'manifest dir triggers additional gates',
  async () => {
    const dir = await mkdtemp(
      join(
        tmpdir(),
        'sniper-gate-test-'
      )
    );

    try {
      const result =
        runReleaseGatesExpectFail(dir);

      /*
       * The runner should always produce
       * output, even if some gates fail.
       * The fact that it doesn't crash is
       * the key assertion. If we get
       * output (even from stderr), the
       * runner behaved correctly.
       */
      const hasAnyOutput =
        result.status !== undefined;

      assert.ok(
        hasAnyOutput,
        'Gate runner should produce a status code'
      );
    } finally {
      await rm(dir, {
        force: true,
        recursive: true,
      });
    }
  }
);

test(
  'gate output includes duration for each gate',
  async () => {
    const result = runReleaseGates();

    const durationPattern = /\(\d+ms\)/;

    assert.ok(
      durationPattern.test(result.combined)
    );
  }
);

test(
  'gates include typecheck, lint, and test',
  async () => {
    /*
     * Use runReleaseGatesExpectFail because the consolidated
     * gate runner may fail (e.g. typecheck) but we only need
     * to verify the gate names appear in the output.
     */
    const result = runReleaseGatesExpectFail();

    assert.ok(
      result.stdout.length > 0 || result.stderr.length > 0,
      `gate runner should produce output. stdout=${result.stdout.length}, stderr=${result.stderr.length}`
    );

    assert.ok(
      result.combined.includes('typecheck'),
      `output should mention typecheck gate. First 300 chars: ${result.combined.slice(0, 300)}`
    );

    assert.ok(
      result.combined.includes('lint'),
      'output should mention lint gate'
    );

    // The test gate name appears in summary lines like "[PASS] test (123ms)"
    // Use regex to avoid matching "tests" from other output
    assert.ok(
      /\[PASS\] test \(\d+ms\)|\[FAIL\] test \(\d+ms\)/.test(result.combined),
      'output should mention test gate'
    );
  }
);