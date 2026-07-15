import assert from 'node:assert/strict';
import test from 'node:test';

function makeJournalEntry(overrides: Partial<import('../sniper/jito-bundle-journal.js').BundleJournalEntry> = {}): import('../sniper/jito-bundle-journal.js').BundleJournalEntry {
  return {
    version: 1,
    planId: 'plan1',
    artifactId: 'artifact1',
    attemptId: 'attempt1',
    bundleId: 'bundle_abc123',
    txSignature: 'sig_xyz789',
    tipAmount: 100_000,
    submissionState: 'submitted',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    reconcileAttempts: 0,
    ...overrides,
  };
}

test(
  'reconciler transitions submitted→landed on confirmation',
  async () => {
    const { reconcileBundleState } = await import('../sniper/jito-reconciler.js');

    const entry = makeJournalEntry({ submissionState: 'submitted' });
    const result = reconcileBundleState(entry, 'landed', 'confirmed', true);

    assert.equal(result.newState, 'landed');
    assert.equal(result.fallbackRecommended, false);
  }
);

test(
  'reconciler transitions submitted→ambiguous on timeout',
  async () => {
    const { reconcileBundleState } = await import('../sniper/jito-reconciler.js');

    const entry = makeJournalEntry({ submissionState: 'submitted' });
    const result = reconcileBundleState(entry, 'pending', 'not_found', true);

    assert.equal(result.newState, 'ambiguous');
    assert.equal(result.fallbackRecommended, false);
  }
);

test(
  'reconciler transitions submitted→rejected on expired blockhash',
  async () => {
    const { reconcileBundleState } = await import('../sniper/jito-reconciler.js');

    const entry = makeJournalEntry({ submissionState: 'submitted' });
    const result = reconcileBundleState(entry, 'pending', 'not_found', false);

    assert.equal(result.newState, 'rejected');
    assert.equal(result.fallbackRecommended, true);
  }
);

test(
  'reconciler transitions ambiguous→landed on late confirmation',
  async () => {
    const { reconcileBundleState } = await import('../sniper/jito-reconciler.js');

    const entry = makeJournalEntry({ submissionState: 'ambiguous' });
    const result = reconcileBundleState(entry, 'landed', 'confirmed', false);

    assert.equal(result.newState, 'landed');
  }
);

test(
  'reconciler transitions ambiguous→reconciled on proven non-landing',
  async () => {
    const { reconcileBundleState } = await import('../sniper/jito-reconciler.js');

    const entry = makeJournalEntry({ submissionState: 'ambiguous' });
    const result = reconcileBundleState(entry, 'failed', 'failed', false);

    assert.equal(result.newState, 'rejected');
  }
);

test(
  'tip amount validation rejects excessive tips',
  async () => {
    const { validateTipAmount } = await import('../sniper/jito-reconciler.js');

    const result = validateTipAmount(2_000_000, 10_000_000, {
      maxAbsoluteTipLamports: 1_000_000,
      maxTipBpsOfPosition: 100,
    });

    assert.equal(result.valid, false);
    assert.ok(result.reason?.includes('exceeds maximum'));
  }
);

test(
  'tip amount validation passes reasonable tips',
  async () => {
    const { validateTipAmount } = await import('../sniper/jito-reconciler.js');

    const result = validateTipAmount(100_000, 10_000_000, {
      maxAbsoluteTipLamports: 1_000_000,
      maxTipBpsOfPosition: 100,
    });

    assert.equal(result.valid, true);
  }
);

test(
  'endpoint validation checks allowlist',
  async () => {
    const { validateEndpoint } = await import('../sniper/jito-reconciler.js');

    const validResult = validateEndpoint(
      'https://mainnet.block-engine.jito.wtf/api/v1/bundles'
    );
    assert.equal(validResult.valid, true);

    const invalidResult = validateEndpoint('https://evil.com/api');
    assert.equal(invalidResult.valid, false);
    assert.ok(invalidResult.reason?.includes('not in allowlist'));
  }
);

test(
  'invalid state transitions are blocked',
  async () => {
    const { reconcileBundleState } = await import('../sniper/jito-reconciler.js');

    const entry = makeJournalEntry({ submissionState: 'landed' });
    const result = reconcileBundleState(entry, 'pending', 'unknown', true);

    // Should stay in landed state since no valid transition exists
    assert.equal(result.newState, 'landed');
    assert.ok(result.reason?.includes('Invalid state transition'));
  }
);