import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
  chmod,
  readFile,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;
let testDir: string;
let riskFile: string;
let auditFile: string;

async function configureEnvironment() {
  if (configured) return;

  testDir = await mkdtemp(
    join(
      tmpdir(),
      'sniper-risk-tamper-'
    )
  );

  riskFile = join(
    testDir,
    'risk.json'
  );
  auditFile = join(
    testDir,
    'audit.jsonl'
  );

  process.env.LIVE_TRADING =
    'false';
  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';
  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';
  process.env.RISK_FILE = riskFile;
  process.env.AUDIT_FILE = auditFile;
  process.env.MAX_DAILY_SPEND_SOL =
    '0.2';
  process.env.MAX_DAILY_TRADES = '3';
  process.env.MAX_DAILY_DRAWDOWN_SOL =
    '0.1';

  configured = true;
}

async function cleanAll() {
  await configureEnvironment();

  await rm(riskFile, {
    force: true,
  });

  await rm(auditFile, {
    force: true,
  });
}

const OPENING_BALANCE = 1_000_000_000n;

test(
  'new risk state is version 2 with valid stateSha256',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    await risk.resetRiskState(
      OPENING_BALANCE
    );

    const state =
      await risk.getRiskState(
        OPENING_BALANCE
      );

    assert.equal(
      state.version,
      2
    );

    assert.match(
      state.stateSha256,
      /^[0-9a-f]{64}$/
    );

    /*
     * The on-disk file must also carry version 2
     * and the hash.
     */
    const content =
      await readFile(
        riskFile,
        'utf8'
      );

    const parsed = JSON.parse(
      content
    );

    assert.equal(
      parsed.version,
      2
    );

    assert.match(
      parsed.stateSha256,
      /^[0-9a-f]{64}$/
    );

    await risk.deleteRiskFileForTests();
  }
);

test(
  'changing spentLamports without changing hash is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    await risk.resetRiskState(
      OPENING_BALANCE
    );

    /*
     * Read the file, tamper with spentLamports,
     * write it back WITHOUT updating the hash.
     */
    const content =
      await readFile(
        riskFile,
        'utf8'
      );

    const parsed = JSON.parse(
      content
    );

    parsed.spentLamports =
      '999999999';

    await writeFile(
      riskFile,
      JSON.stringify(
        parsed,
        null,
        2
      ),
      'utf8'
    );

    await assert.rejects(
      risk.getRiskState(
        OPENING_BALANCE
      ),
      /Risk state hash mismatch/i
    );

    await risk.deleteRiskFileForTests();
  }
);

test(
  'changing reservations without changing hash is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    await risk.reserveTrade(
      'TEST_MINT',
      50_000_000n,
      OPENING_BALANCE
    );

    /*
     * Tamper: add a fake reservation without
     * updating the hash.
     */
    const content =
      await readFile(
        riskFile,
        'utf8'
      );

    const parsed = JSON.parse(
      content
    );

    parsed.reservations.push({
      id: 'fake-reservation-id',
      mint: 'FAKE_MINT',
      amountLamports: '1',
      createdAt:
        new Date().toISOString(),
    });

    await writeFile(
      riskFile,
      JSON.stringify(
        parsed,
        null,
        2
      ),
      'utf8'
    );

    await assert.rejects(
      risk.getRiskState(
        OPENING_BALANCE
      ),
      /Risk state hash mismatch/i
    );

    await risk.deleteRiskFileForTests();
  }
);

test(
  'duplicate reservation IDs are rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    await risk.resetRiskState(
      OPENING_BALANCE
    );

    /*
     * Tamper: add two reservations with the same
     * ID, then recompute the hash so the hash
     * check passes but the structural validation
     * catches the duplicate.
     */
    const content =
      await readFile(
        riskFile,
        'utf8'
      );

    const parsed = JSON.parse(
      content
    );

    const dupReservation = {
      id: 'dup-id-1',
      mint: 'DUP_MINT',
      amountLamports: '1000',
      createdAt:
        new Date().toISOString(),
    };

    parsed.reservations = [
      dupReservation,
      { ...dupReservation },
    ];

    const { createHash } =
      await import(
        'node:crypto'
      );

    const stableStringify = (
      value: unknown
    ): string => {
      if (
        value === null ||
        typeof value !== 'object'
      ) {
        return JSON.stringify(value);
      }

      if (Array.isArray(value)) {
        return `[${value
          .map(stableStringify)
          .join(',')}]`;
      }

      const entries = Object.entries(
        value as Record<
          string,
          unknown
        >
      )
        .filter(
          ([, v]) =>
            v !== undefined
        )
        .sort(([a], [b]) =>
          a.localeCompare(b)
        );

      return `{${entries
        .map(
          ([k, v]) =>
            `${JSON.stringify(k)}:${stableStringify(v)}`
        )
        .join(',')}}`;
    };

    const { stateSha256, ...body } =
      parsed;

    parsed.stateSha256 = createHash(
      'sha256'
    )
      .update(
        stableStringify({
          ...body,
          version: 2,
        })
      )
      .digest('hex');

    await writeFile(
      riskFile,
      JSON.stringify(
        parsed,
        null,
        2
      ),
      'utf8'
    );

    await assert.rejects(
      risk.getRiskState(
        OPENING_BALANCE
      ),
      /Duplicate active risk reservation/i
    );

    await risk.deleteRiskFileForTests();
  }
);

test(
  'active and committed duplicate ID is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    const reservation =
      await risk.reserveTrade(
        'TEST_MINT',
        50_000_000n,
        OPENING_BALANCE
      );

    await risk.commitReservation(
      reservation.id,
      OPENING_BALANCE
    );

    /*
     * Tamper: add the same ID back into the
     * active reservations array AND recompute
     * the hash so the structural validation
     * catches the active+committed conflict.
     */
    const content =
      await readFile(
        riskFile,
        'utf8'
      );

    const parsed = JSON.parse(
      content
    );

    parsed.reservations.push({
      id: reservation.id,
      mint: 'TEST_MINT',
      amountLamports: '50000000',
      createdAt:
        new Date().toISOString(),
    });

    const { createHash } =
      await import(
        'node:crypto'
      );

    const stableStringify = (
      value: unknown
    ): string => {
      if (
        value === null ||
        typeof value !== 'object'
      ) {
        return JSON.stringify(value);
      }

      if (Array.isArray(value)) {
        return `[${value
          .map(stableStringify)
          .join(',')}]`;
      }

      const entries = Object.entries(
        value as Record<
          string,
          unknown
        >
      )
        .filter(
          ([, v]) =>
            v !== undefined
        )
        .sort(([a], [b]) =>
          a.localeCompare(b)
        );

      return `{${entries
        .map(
          ([k, v]) =>
            `${JSON.stringify(k)}:${stableStringify(v)}`
        )
        .join(',')}}`;
    };

    const { stateSha256, ...body } =
      parsed;

    parsed.stateSha256 = createHash(
      'sha256'
    )
      .update(
        stableStringify({
          ...body,
          version: 2,
        })
      )
      .digest('hex');

    await writeFile(
      riskFile,
      JSON.stringify(
        parsed,
        null,
        2
      ),
      'utf8'
    );

    await assert.rejects(
      risk.getRiskState(
        OPENING_BALANCE
      ),
      /is both active and committed/i
    );

    await risk.deleteRiskFileForTests();
  }
);

test(
  'symlink risk file is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    const target = join(
      testDir,
      'risk-target.json'
    );

    await writeFile(
      target,
      '{"version":2}',
      'utf8'
    );

    await rm(riskFile, {
      force: true,
    });

    await symlink(
      target,
      riskFile
    );

    await assert.rejects(
      risk.getRiskState(
        OPENING_BALANCE
      ),
      /symbolic link/i
    );

    await rm(riskFile, {
      force: true,
    });

    await rm(target, {
      force: true,
    });
  }
);

test(
  'permissions broader than 0600 are rejected on Unix',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Skip on Windows — the permission check is
     * Unix-only.
     */
    if (
      process.platform === 'win32'
    ) {
      return;
    }

    const risk =
      await import(
        '../sniper/risk.js'
      );

    await risk.resetRiskState(
      OPENING_BALANCE
    );

    /*
     * Loosen permissions to 0644 (group-readable).
     */
    await chmod(riskFile, 0o644);

    await assert.rejects(
      risk.getRiskState(
        OPENING_BALANCE
      ),
      /permissions are too open/i
    );

    /*
     * Restore to 0600 so cleanup works.
     */
    await chmod(riskFile, 0o600);

    await risk.deleteRiskFileForTests();
  }
);

test(
  'version 1 state loads and upgrades on next write',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    /*
     * Write a v1 state file (no stateSha256).
     */
    const v1State = {
      version: 1,
      utcDate:
        new Date()
          .toISOString()
          .slice(0, 10),
      openingBalanceLamports:
        OPENING_BALANCE.toString(),
      spentLamports: '0',
      completedTrades: 0,
      reservations: [],
      committedReservationIds: [],
      completedTradeIds: [],
      updatedAt:
        new Date().toISOString(),
    };

    await writeFile(
      riskFile,
      JSON.stringify(
        v1State,
        null,
        2
      ),
      {
        encoding: 'utf8',
        mode: 0o600,
      }
    );

    /*
     * Loading must succeed (v1 is accepted for
     * one-way migration).
     */
    const loaded =
      await risk.getRiskState(
        OPENING_BALANCE
      );

    assert.equal(
      loaded.version,
      2
    );

    assert.match(
      loaded.stateSha256,
      /^[0-9a-f]{64}$/
    );

    /*
     * The next write must persist a v2 state.
     */
    await risk.reserveTrade(
      'UPGRADED_MINT',
      10_000_000n,
      OPENING_BALANCE
    );

    const content =
      await readFile(
        riskFile,
        'utf8'
      );

    const parsed = JSON.parse(
      content
    );

    assert.equal(
      parsed.version,
      2
    );

    assert.match(
      parsed.stateSha256,
      /^[0-9a-f]{64}$/
    );

    await risk.deleteRiskFileForTests();
  }
);

test(
  'concurrent reservations preserve a valid final hash',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    await risk.resetRiskState(
      OPENING_BALANCE
    );

    /*
     * Fire multiple concurrent reservations.
     * The serialize() queue ensures they run
     * one at a time, each producing a valid
     * hash.
     */
    const ids = [
      'res-a',
      'res-b',
      'res-c',
    ];

    await Promise.all(
      ids.map((id) =>
        risk.reserveTradeOnce(
          id,
          'CONCURRENT_MINT',
          10_000_000n,
          OPENING_BALANCE
        )
      )
    );

    const state =
      await risk.getRiskState(
        OPENING_BALANCE
      );

    assert.equal(
      state.reservations.length,
      3
    );

    /*
     * Reload from disk to verify the hash
     * survives the concurrent writes.
     */
    const content =
      await readFile(
        riskFile,
        'utf8'
      );

    const parsed = JSON.parse(
      content
    );

    assert.equal(
      parsed.stateSha256,
      state.stateSha256
    );

    await risk.deleteRiskFileForTests();
  }
);

test(
  'existing reservation idempotency still works',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    const first =
      await risk.reserveTradeOnce(
        'idempotent-1',
        'TEST_MINT',
        50_000_000n,
        OPENING_BALANCE
      );

    const second =
      await risk.reserveTradeOnce(
        'idempotent-1',
        'TEST_MINT',
        50_000_000n,
        OPENING_BALANCE
      );

    assert.equal(
      first.id,
      second.id
    );

    const state =
      await risk.getRiskState(
        OPENING_BALANCE
      );

    assert.equal(
      state.reservations.length,
      1
    );

    /*
     * The hash must be valid after the
     * idempotent second call.
     */
    assert.match(
      state.stateSha256,
      /^[0-9a-f]{64}$/
    );

    await risk.deleteRiskFileForTests();
  }
);

test(
  'risk doctor reports hash corruption',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    await risk.resetRiskState(
      OPENING_BALANCE
    );

    /*
     * Tamper with the file: change spentLamports
     * without updating the hash.
     */
    const content =
      await readFile(
        riskFile,
        'utf8'
      );

    const parsed = JSON.parse(
      content
    );

    parsed.spentLamports =
      '999999999';

    await writeFile(
      riskFile,
      JSON.stringify(
        parsed,
        null,
        2
      ),
      'utf8'
    );

    /*
     * Any risk operation that loads the state
     * must throw a hash mismatch.
     */
    await assert.rejects(
      risk.getRiskState(
        OPENING_BALANCE
      ),
      /Risk state hash mismatch/i
    );

    await risk.deleteRiskFileForTests();
  }
);
