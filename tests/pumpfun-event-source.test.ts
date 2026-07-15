import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'validates a correct Pump.fun event',
  async () => {
    const { validateRawEvent } = await import('../sniper/pumpfun-event-source.js');

    const result = validateRawEvent({
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      instructionIndex: 0,
      discriminator: 'create',
      mint: 'Mint1111111111111111111111111111111111',
      creator: 'Creator111111111111111111111111111111',
      signature: 'sig_abc123',
      slot: 250000000,
      success: true,
      version: 1,
      timestamp: '2025-01-01T00:00:00Z',
    });

    assert.equal(result.valid, true);
    assert.ok(result.event);
    assert.equal(result.event!.mint, 'Mint1111111111111111111111111111111111');
  }
);

test(
  'rejects unknown program ID',
  async () => {
    const { validateRawEvent } = await import('../sniper/pumpfun-event-source.js');

    const result = validateRawEvent({
      programId: 'UnknownProgram111111111111111111111111',
      instructionIndex: 0,
      discriminator: 'create',
      mint: 'Mint1111111111111111111111111111111111',
      creator: 'Creator111111111111111111111111111111',
      signature: 'sig_abc123',
      slot: 250000000,
      success: true,
      version: 1,
      timestamp: '2025-01-01T00:00:00Z',
    });

    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('Unknown program'));
  }
);

test(
  'rejects failed transactions',
  async () => {
    const { validateRawEvent } = await import('../sniper/pumpfun-event-source.js');

    const result = validateRawEvent({
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      instructionIndex: 0,
      discriminator: 'create',
      mint: 'Mint1111111111111111111111111111111111',
      creator: 'Creator111111111111111111111111111111',
      signature: 'sig_failed',
      slot: 250000000,
      success: false,
      version: 1,
      timestamp: '2025-01-01T00:00:00Z',
    });

    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('not successful'));
  }
);

test(
  'rejects unknown event versions',
  async () => {
    const { validateRawEvent } = await import('../sniper/pumpfun-event-source.js');

    const result = validateRawEvent({
      programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      instructionIndex: 0,
      discriminator: 'create',
      mint: 'Mint1111111111111111111111111111111111',
      creator: 'Creator111111111111111111111111111111',
      signature: 'sig_unknown_ver',
      slot: 250000000,
      success: true,
      version: 99,
      timestamp: '2025-01-01T00:00:00Z',
    });

    assert.equal(result.valid, false);
    assert.ok(result.error?.includes('Unknown event version'));
  }
);

test(
  'isKnownPumpfunProgram returns true for known IDs',
  async () => {
    const { isKnownPumpfunProgram } = await import('../sniper/pumpfun-event-source.js');

    assert.equal(isKnownPumpfunProgram('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'), true);
    assert.equal(isKnownPumpfunProgram('Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1'), true);
    assert.equal(isKnownPumpfunProgram('UnknownProgram1111111111111111111'), false);
  }
);