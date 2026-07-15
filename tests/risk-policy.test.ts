import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'policy allows when all evidence is fresh and complete',
  async () => {
    const { evaluateRiskPolicy } = await import('../sniper/risk-policy.js');

    const result = evaluateRiskPolicy(
      {
        mintAddress: 'Mint1111111111111111111111111111111',
        sources: [
          {
            provider: 'helius',
            observedSlot: 250000000,
            observedAt: new Date().toISOString(),
            fetchedAt: new Date().toISOString(),
            complete: true,
          },
        ],
        assessedAt: new Date().toISOString(),
        reportHash: 'abc123',
      },
      250000005,
      { maxSlotLag: 20, maxAgeSeconds: 60 }
    );

    assert.equal(result.decision, 'allow');
    assert.equal(result.failClosedConditions.length, 0);
  }
);

test(
  'policy rejects incomplete provider data',
  async () => {
    const { evaluateRiskPolicy } = await import('../sniper/risk-policy.js');

    const result = evaluateRiskPolicy(
      {
        mintAddress: 'Mint2222222222222222222222222222222',
        sources: [
          {
            provider: 'helius',
            observedSlot: 250000000,
            observedAt: new Date().toISOString(),
            fetchedAt: new Date().toISOString(),
            complete: false,
          },
        ],
        assessedAt: new Date().toISOString(),
        reportHash: 'def456',
      },
      250000005
    );

    assert.equal(result.decision, 'reject');
    assert.ok(result.failClosedConditions.includes('holder_pagination_incomplete'));
  }
);

test(
  'policy detects provider disagreement',
  async () => {
    const { evaluateRiskPolicy } = await import('../sniper/risk-policy.js');

    const result = evaluateRiskPolicy(
      {
        mintAddress: 'Mint3333333333333333333333333333333',
        sources: [
          {
            provider: 'helius',
            observedSlot: 250000000,
            observedAt: new Date().toISOString(),
            fetchedAt: new Date().toISOString(),
            complete: true,
          },
          {
            provider: 'shyft',
            observedSlot: 249999900,
            observedAt: new Date().toISOString(),
            fetchedAt: new Date().toISOString(),
            complete: true,
          },
        ],
        assessedAt: new Date().toISOString(),
        reportHash: 'ghi789',
      },
      250000005,
      { maxSlotLag: 20 }
    );

    assert.equal(result.decision, 'reject');
    assert.ok(result.failClosedConditions.includes('provider_disagreement'));
  }
);

test(
  'verifyRiskEvidenceBinding rejects missing hash',
  async () => {
    const { verifyRiskEvidenceBinding } = await import('../sniper/risk-policy.js');

    const result = verifyRiskEvidenceBinding({}, 'expected_hash');

    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes('no risk evidence hash'));
  }
);

test(
  'verifyRiskEvidenceBinding rejects mismatched hash',
  async () => {
    const { verifyRiskEvidenceBinding } = await import('../sniper/risk-policy.js');

    const result = verifyRiskEvidenceBinding(
      { riskReportHash: 'wrong_hash' },
      'expected_hash'
    );

    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes('mismatch'));
  }
);