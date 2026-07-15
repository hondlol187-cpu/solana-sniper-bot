import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readFile,
  writeFile,
  mkdtemp,
  rm,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnSync } from 'node:child_process';

function runAuditGate(
  findingsPath: string
): {
  status: number | null;
  stdout: string;
  stderr: string;
} {
  /*
   * Copy the findings file to the expected location.
   */
  const result = spawnSync(
    process.execPath,
    [
      join(process.cwd(), 'node_modules/tsx/dist/cli.mjs'),
      'sniper/verify-audit-findings.ts',
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
      },
      encoding: 'utf8',
    }
  );

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

test(
  'audit gate passes with only resolved findings',
  async () => {
    /*
     * The default security/audit-findings.json has
     * only a resolved template entry.
     */
    const result = runAuditGate(
      join(process.cwd(), 'security', 'audit-findings.json')
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /AUDIT GATE PASSED/);
  }
);

test(
  'audit gate fails with open critical finding',
  async () => {
    /*
     * Temporarily replace the findings file.
     */
    const findingsPath = join(
      process.cwd(),
      'security',
      'audit-findings.json'
    );

    const original = await readFile(findingsPath, 'utf8');

    const badFindings = [
      {
        id: 'AUDIT-001',
        severity: 'critical',
        status: 'open',
        summary: 'Test critical finding',
        fixCommit: null,
      },
    ];

    try {
      await writeFile(
        findingsPath,
        JSON.stringify(badFindings, null, 2),
        'utf8'
      );

      const result = runAuditGate(findingsPath);

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /Unresolved critical finding/i
      );
    } finally {
      await writeFile(
        findingsPath,
        original,
        'utf8'
      );
    }
  }
);

test(
  'audit gate fails with open high finding',
  async () => {
    const findingsPath = join(
      process.cwd(),
      'security',
      'audit-findings.json'
    );

    const original = await readFile(findingsPath, 'utf8');

    const badFindings = [
      {
        id: 'AUDIT-002',
        severity: 'high',
        status: 'open',
        summary: 'Test high finding',
        fixCommit: null,
      },
    ];

    try {
      await writeFile(
        findingsPath,
        JSON.stringify(badFindings, null, 2),
        'utf8'
      );

      const result = runAuditGate(findingsPath);

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /Unresolved high finding/i
      );
    } finally {
      await writeFile(
        findingsPath,
        original,
        'utf8'
      );
    }
  }
);

test(
  'audit gate passes with open low finding',
  async () => {
    const findingsPath = join(
      process.cwd(),
      'security',
      'audit-findings.json'
    );

    const original = await readFile(findingsPath, 'utf8');

    const lowFindings = [
      {
        id: 'AUDIT-003',
        severity: 'low',
        status: 'open',
        summary: 'Test low finding',
        fixCommit: null,
      },
    ];

    try {
      await writeFile(
        findingsPath,
        JSON.stringify(lowFindings, null, 2),
        'utf8'
      );

      const result = runAuditGate(findingsPath);

      assert.equal(result.status, 0);
    } finally {
      await writeFile(
        findingsPath,
        original,
        'utf8'
      );
    }
  }
);

test(
  'suppressed finding requires rationale and expiry',
  async () => {
    const findingsPath = join(
      process.cwd(),
      'security',
      'audit-findings.json'
    );

    const original = await readFile(findingsPath, 'utf8');

    const suppressedFindings = [
      {
        id: 'AUDIT-004',
        severity: 'critical',
        status: 'suppressed',
        summary: 'Test suppressed without rationale',
        fixCommit: null,
      },
    ];

    try {
      await writeFile(
        findingsPath,
        JSON.stringify(suppressedFindings, null, 2),
        'utf8'
      );

      const result = runAuditGate(findingsPath);

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /no rationale/i
      );
    } finally {
      await writeFile(
        findingsPath,
        original,
        'utf8'
      );
    }
  }
);

test(
  'expired suppression rejects',
  async () => {
    const findingsPath = join(
      process.cwd(),
      'security',
      'audit-findings.json'
    );

    const original = await readFile(findingsPath, 'utf8');

    const expiredFindings = [
      {
        id: 'AUDIT-005',
        severity: 'critical',
        status: 'suppressed',
        summary: 'Test expired suppression',
        fixCommit: null,
        suppressionRationale: 'Temporary fix in progress',
        suppressionExpiry: '2020-01-01T00:00:00.000Z',
      },
    ];

    try {
      await writeFile(
        findingsPath,
        JSON.stringify(expiredFindings, null, 2),
        'utf8'
      );

      const result = runAuditGate(findingsPath);

      assert.notEqual(result.status, 0);
      assert.match(
        result.stderr,
        /expired/i
      );
    } finally {
      await writeFile(
        findingsPath,
        original,
        'utf8'
      );
    }
  }
);
