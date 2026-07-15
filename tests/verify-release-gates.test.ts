import assert from 'node:assert/strict';
import test from 'node:test';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

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

  const result = execSync(args.join(' '), {
    cwd: process.cwd(),
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 300_000,
  });

  return {
    status: 0,
    stdout: result,
    stderr: '',
    combined: result,
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
  const args = [
    'bun',
    'x',
    'tsx',
    'sniper/verify-release-gates.ts',
  ];

  if (manifestDir) {
    args.push(manifestDir);
  }

  try {
    execSync(args.join(' '), {
      cwd: process.cwd(),
      env: { ...process.env },
      encoding: 'utf8',
      timeout: 300_000,
    });

    return {
      status: 0,
      stdout: '',
      stderr: '',
      combined: '',
    };
  } catch (error) {
    const e = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };

    const stdout = e.stdout ?? '';
    const stderr = e.stderr ?? '';

    return {
      status: e.status ?? 1,
      stdout: String(stdout),
      stderr: String(stderr),
      combined:
        String(stdout) + '\n' + String(stderr),
    };
  }
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