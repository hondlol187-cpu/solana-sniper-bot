import assert from 'node:assert/strict';
import test from 'node:test';

function makeRawEvent(slot: number, sig: string): any {
  return {
    programId: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    instructionIndex: 0,
    discriminator: 'create',
    mint: 'Mint1111111111111111111111111111111',
    creator: 'Creator111111111111111111111111111',
    signature: sig,
    slot,
    success: true,
    version: 1,
    timestamp: new Date().toISOString(),
  };
}

test(
  'reconciler deduplicates events by signature:index',
  async () => {
    const { PumpfunReconciler } = await import('../sniper/pumpfun-reconciler.js');

    const reconciler = new PumpfunReconciler();
    const event = makeRawEvent(100, 'sig_dedup_001');

    const result1 = reconciler.deduplicate(event);
    assert.equal(result1.duplicate, false);

    const result2 = reconciler.deduplicate(event);
    assert.equal(result2.duplicate, true);

    const state = reconciler.getState();
    assert.equal(state.duplicatesDeduped, 1);
  }
);

test(
  'reconciler tracks slots and detects gaps',
  async () => {
    const { PumpfunReconciler } = await import('../sniper/pumpfun-reconciler.js');

    const reconciler = new PumpfunReconciler();
    reconciler.updateSlot(100);

    const gap = reconciler.detectGap(105);
    assert.ok(gap);
    assert.equal(gap!.startSlot, 101);
    assert.equal(gap!.endSlot, 104);
  }
);

test(
  'reconciler refuses unbounded gaps',
  async () => {
    const { PumpfunReconciler } = await import('../sniper/pumpfun-reconciler.js');

    const reconciler = new PumpfunReconciler();
    reconciler.updateSlot(100);

    assert.throws(
      () => reconciler.detectGap(100_100),
      /Unbounded gap/
    );
  }
);

test(
  'backoff increases with consecutive errors',
  async () => {
    const { PumpfunReconciler } = await import('../sniper/pumpfun-reconciler.js');

    const reconciler = new PumpfunReconciler();

    const backoff1 = reconciler.getBackoffMs();
    reconciler.recordError();
    const backoff2 = reconciler.getBackoffMs();
    reconciler.recordError();
    const backoff3 = reconciler.getBackoffMs();

    assert.ok(backoff2 > backoff1, 'Backoff should increase after error');
    assert.ok(backoff3 > backoff2, 'Backoff should keep increasing');
  }
);

test(
  'reconciler records reconnects',
  async () => {
    const { PumpfunReconciler } = await import('../sniper/pumpfun-reconciler.js');

    const reconciler = new PumpfunReconciler();
    reconciler.recordReconnect();
    reconciler.recordReconnect();

    const state = reconciler.getState();
    assert.equal(state.reconnectCount, 2);
    assert.ok(state.lastReconnectAt);
  }
);

test(
  'reconciler records gap reconciliation',
  async () => {
    const { PumpfunReconciler } = await import('../sniper/pumpfun-reconciler.js');

    const reconciler = new PumpfunReconciler();
    reconciler.updateSlot(100);

    const gap = reconciler.detectGap(105);
    assert.ok(gap);

    reconciler.recordGapReconciliation(gap!.startSlot, gap!.endSlot, 3);

    const state = reconciler.getState();
    assert.equal(state.gapsReconciled, 1);
    assert.equal(state.lastProcessedSlot, 104);

    const gaps = reconciler.getGaps();
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].reconciledEvents, 3);
  }
);