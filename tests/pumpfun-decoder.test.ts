import assert from 'node:assert/strict';
import test from 'node:test';

function makeRawEvent(overrides: Record<string, unknown> = {}): any {
  return {
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    instructionIndex: 0,
    discriminator: 'create',
    mint: 'MintABC111111111111111111111111111111',
    creator: 'CreatorABC11111111111111111111111111',
    bondingCurveAccount: 'BondingCurve111111111111111111111',
    signature: 'sig_decode_test',
    slot: 250000000,
    success: true,
    version: 1,
    timestamp: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

test(
  'decodes a create event into a launch signal',
  async () => {
    const { decodePumpfunEvent } = await import('../sniper/pumpfun-decoder.js');

    const raw = makeRawEvent();
    const decoded = decodePumpfunEvent(raw);

    assert.ok(decoded.signal);
    assert.equal(decoded.signal!.source, 'pumpfun');
    assert.equal(decoded.signal!.mint, 'MintABC111111111111111111111111111111');
    assert.equal(decoded.signal!.creator, 'CreatorABC11111111111111111111111111');
    assert.equal(decoded.signal!.signature, 'sig_decode_test');
    assert.equal(decoded.isMigration, false);
  }
);

test(
  'migration event is flagged but has no signal',
  async () => {
    const { decodePumpfunEvent } = await import('../sniper/pumpfun-decoder.js');

    const raw = makeRawEvent({ discriminator: 'migration' });
    const decoded = decodePumpfunEvent(raw);

    assert.equal(decoded.isMigration, true);
    assert.equal(decoded.signal, undefined);
    assert.ok(decoded.bondingCurveSnapshot);
    assert.equal(decoded.bondingCurveSnapshot!.complete, true);
  }
);

test(
  'buy event produces no launch signal',
  async () => {
    const { decodePumpfunEvent } = await import('../sniper/pumpfun-decoder.js');

    const raw = makeRawEvent({ discriminator: 'buy' });
    const decoded = decodePumpfunEvent(raw);

    assert.equal(decoded.signal, undefined);
    assert.equal(decoded.isMigration, false);
  }
);

test(
  'isValidDiscriminator recognizes known types',
  async () => {
    const { isValidDiscriminator } = await import('../sniper/pumpfun-decoder.js');

    assert.equal(isValidDiscriminator('create'), true);
    assert.equal(isValidDiscriminator('buy'), true);
    assert.equal(isValidDiscriminator('sell'), true);
    assert.equal(isValidDiscriminator('migration'), true);
    assert.equal(isValidDiscriminator('unknown'), false);
  }
);

test(
  'extractDedupKey produces consistent keys',
  async () => {
    const { extractDedupKey } = await import('../sniper/pumpfun-decoder.js');

    const raw = makeRawEvent();
    const key1 = extractDedupKey(raw);
    const key2 = extractDedupKey(raw);

    assert.equal(key1, 'sig_decode_test:0');
    assert.equal(key1, key2);
  }
);