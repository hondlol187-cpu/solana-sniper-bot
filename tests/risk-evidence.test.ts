import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'fresh evidence produces allow decision',
  async () => {
    const { buildRiskEvidence } = await import('../sniper/risk-evidence.js');

    const bundle = buildRiskEvidence(
      'Mint1111111111111111111111111111111',
      [
        {
          provider: 'helius',
          observedSlot: 250000000,
          observedAt: new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          complete: true,
        },
      ],
      true,
      250000005,
      { maxSlotLag: 20, maxAgeSeconds: 60 }
    );

    assert.equal(bundle.decision, 'allow');
    assert.ok(bundle.evidence.reportHash);
  }
);

test(
  'stale evidence produces reject decision',
  async () => {
    const { buildRiskEvidence } = await import('../sniper/risk-evidence.js');

    const oldTime = new Date(Date.now() - 100_000).toISOString();

    const bundle = buildRiskEvidence(
      'Mint2222222222222222222222222222222',
      [
        {
          provider: 'helius',
          observedSlot: 240000000,
          observedAt: oldTime,
          fetchedAt: oldTime,
          complete: true,
        },
      ],
      true,
      250000000,
      { maxSlotLag: 20, maxAgeSeconds: 20 }
    );

    assert.equal(bundle.decision, 'reject');
  }
);

test(
  'incomplete source produces reject',
  async () => {
    const { buildRiskEvidence } = await import('../sniper/risk-evidence.js');

    const bundle = buildRiskEvidence(
      'Mint3333333333333333333333333333333',
      [
        {
          provider: 'helius',
          observedSlot: 250000000,
          observedAt: new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          complete: false,
        },
      ],
      true,
      250000005
    );

    assert.equal(bundle.decision, 'reject');
  }
);

test(
  'risk report hash is deterministic',
  async () => {
    const { computeRiskReportHash } = await import('../sniper/risk-evidence.js');

    const sources = [
      { provider: 'helius', observedSlot: 100, observedAt: 't1', fetchedAt: 't2', complete: true },
    ];

    const hash1 = computeRiskReportHash('mint1', sources);
    const hash2 = computeRiskReportHash('mint1', sources);

    assert.equal(hash1, hash2);
  }
);

test(
  'different inputs produce different hashes',
  async () => {
    const { computeRiskReportHash } = await import('../sniper/risk-evidence.js');

    const sources = [
      { provider: 'helius', observedSlot: 100, observedAt: 't1', fetchedAt: 't2', complete: true },
    ];

    const hash1 = computeRiskReportHash('mint1', sources);
    const hash2 = computeRiskReportHash('mint2', sources);

    assert.notEqual(hash1, hash2);
  }
);

test(
  'system account allowlist excludes known programs',
  async () => {
    const { isSystemAccount, SYSTEM_ACCOUNT_ALLOWLIST } = await import('../sniper/risk-evidence.js');

    assert.ok(isSystemAccount('11111111111111111111111111111111'));
    assert.ok(isSystemAccount('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'));
    assert.ok(!isSystemAccount('SomeRandomWallet11111111111111111'));
  }
);