import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'healthy provider stays healthy with events',
  async () => {
    const { ProviderHealthTracker } = await import('../sniper/provider-health.js');

    const tracker = new ProviderHealthTracker('test');
    tracker.setCurrentChainSlot(100);

    tracker.recordEvent(99);
    tracker.recordEvent(100);

    const state = tracker.evaluate();
    assert.equal(state, 'healthy');
  }
);

test(
  'provider opens circuit on excessive slot lag',
  async () => {
    const { ProviderHealthTracker } = await import('../sniper/provider-health.js');

    const tracker = new ProviderHealthTracker('test', { maxSlotLag: 10 });
    tracker.setCurrentChainSlot(100);
    tracker.recordEvent(50); // lag of 50

    const state = tracker.evaluate();
    assert.equal(state, 'open');
  }
);

test(
  'provider degrades on heartbeat timeout',
  async () => {
    const { ProviderHealthTracker } = await import('../sniper/provider-health.js');

    const tracker = new ProviderHealthTracker('test', { heartbeatTimeoutSeconds: 0 });
    tracker.setCurrentChainSlot(100);
    tracker.recordEvent(99); // sets lastEventTime to now

    // Small delay to exceed 0s timeout
    await new Promise(r => setTimeout(r, 10));

    const state = tracker.evaluate();
    assert.equal(state, 'degraded');
  }
);

test(
  'provider opens on too many errors',
  async () => {
    const { ProviderHealthTracker } = await import('../sniper/provider-health.js');

    const tracker = new ProviderHealthTracker('test', { maxErrorsPerMinute: 3 });
    tracker.setCurrentChainSlot(100);

    for (let i = 0; i < 5; i++) {
      tracker.recordError();
    }

    const state = tracker.evaluate();
    assert.equal(state, 'open');
  }
);

test(
  'provider recovers after enough probes',
  async () => {
    const { ProviderHealthTracker } = await import('../sniper/provider-health.js');

    const tracker = new ProviderHealthTracker('test', {
      maxErrorsPerMinute: 3,
      circuitRecoverySuccessCount: 2,
    });
    tracker.setCurrentChainSlot(100);

    // Open the circuit
    for (let i = 0; i < 5; i++) tracker.recordError();
    tracker.evaluate();
    assert.equal(tracker.getState(), 'open');

    // Recovery probes
    tracker.setCurrentChainSlot(101);
    tracker.recordEvent(101);
    tracker.recordEvent(102);

    assert.equal(tracker.getState(), 'healthy');
  }
);

test(
  'snapshot includes latency percentiles',
  async () => {
    const { ProviderHealthTracker } = await import('../sniper/provider-health.js');

    const tracker = new ProviderHealthTracker('test');
    tracker.recordLatency(10);
    tracker.recordLatency(20);
    tracker.recordLatency(30);
    tracker.recordLatency(50);
    tracker.recordLatency(100);

    const snapshot = tracker.getSnapshot('test');
    assert.ok(snapshot.p50LatencyMs > 0);
    assert.ok(snapshot.p95LatencyMs >= snapshot.p50LatencyMs);
    assert.ok(snapshot.p99LatencyMs >= snapshot.p95LatencyMs);
  }
);