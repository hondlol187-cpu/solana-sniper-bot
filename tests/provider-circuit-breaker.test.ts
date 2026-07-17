import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'circuit breaker allows healthy provider',
  async () => {
    const { ProviderCircuitBreaker } = await import('../sniper/provider-circuit-breaker.js');
    const breaker = new ProviderCircuitBreaker();

    const decision = await breaker.shouldAccept({
      providerName: 'test',
      state: 'healthy',
      lastEventSlot: 100,
      lastEventTime: new Date().toISOString(),
      currentChainSlot: 101,
      slotLag: 1,
      reconnectCount: 0,
      errorsInWindow: 0,
      queueDepth: 5,
      oldestQueuedAgeMs: null,
      droppedDuplicates: 0,
      rejectedOverflow: 0,
      processingLatencyMs: 10,
      p50LatencyMs: 10,
      p95LatencyMs: 20,
      p99LatencyMs: 30,
      snapshotAt: new Date().toISOString(),
    }, { maxSlotLag: 20, maxErrorsPerMinute: 10, heartbeatTimeoutSeconds: 15, maxQueueDepth: 1000, maxQueuedAgeSeconds: 20, recoverySuccessCount: 3 });

    assert.equal(decision.allowed, true);
  }
);

test(
  'circuit breaker rejects open provider',
  async () => {
    const { ProviderCircuitBreaker } = await import('../sniper/provider-circuit-breaker.js');
    const breaker = new ProviderCircuitBreaker();

    const decision = await breaker.shouldAccept({
      providerName: 'test',
      state: 'open',
      lastEventSlot: 50,
      lastEventTime: new Date().toISOString(),
      currentChainSlot: 100,
      slotLag: 50,
      reconnectCount: 2,
      errorsInWindow: 15,
      queueDepth: 0,
      oldestQueuedAgeMs: null,
      droppedDuplicates: 0,
      rejectedOverflow: 0,
      processingLatencyMs: null,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      p99LatencyMs: 0,
      snapshotAt: new Date().toISOString(),
    }, { maxSlotLag: 20, maxErrorsPerMinute: 10, heartbeatTimeoutSeconds: 15, maxQueueDepth: 1000, maxQueuedAgeSeconds: 20, recoverySuccessCount: 3 });

    assert.equal(decision.allowed, false);
    assert.ok(decision.reason?.includes('open'));
  }
);

test(
  'circuit breaker rejects excessive queue depth',
  async () => {
    const { ProviderCircuitBreaker } = await import('../sniper/provider-circuit-breaker.js');
    const breaker = new ProviderCircuitBreaker();

    const decision = await breaker.shouldAccept({
      providerName: 'test',
      state: 'healthy',
      lastEventSlot: 100,
      lastEventTime: new Date().toISOString(),
      currentChainSlot: 101,
      slotLag: 1,
      reconnectCount: 0,
      errorsInWindow: 0,
      queueDepth: 2000,
      oldestQueuedAgeMs: null,
      droppedDuplicates: 0,
      rejectedOverflow: 0,
      processingLatencyMs: 10,
      p50LatencyMs: 10,
      p95LatencyMs: 20,
      p99LatencyMs: 30,
      snapshotAt: new Date().toISOString(),
    }, { maxSlotLag: 20, maxErrorsPerMinute: 10, heartbeatTimeoutSeconds: 15, maxQueueDepth: 1000, maxQueuedAgeSeconds: 20, recoverySuccessCount: 3 });

    assert.equal(decision.allowed, false);
    assert.ok(decision.reason?.includes('queue depth'));
  }
);

test(
  'circuit breaker rejects stale queued candidates',
  async () => {
    const { ProviderCircuitBreaker } = await import('../sniper/provider-circuit-breaker.js');
    const breaker = new ProviderCircuitBreaker();

    const decision = await breaker.shouldAccept({
      providerName: 'test',
      state: 'healthy',
      lastEventSlot: 100,
      lastEventTime: new Date().toISOString(),
      currentChainSlot: 101,
      slotLag: 1,
      reconnectCount: 0,
      errorsInWindow: 0,
      queueDepth: 5,
      oldestQueuedAgeMs: 30_000, // 30 seconds
      droppedDuplicates: 0,
      rejectedOverflow: 0,
      processingLatencyMs: 10,
      p50LatencyMs: 10,
      p95LatencyMs: 20,
      p99LatencyMs: 30,
      snapshotAt: new Date().toISOString(),
    }, { maxSlotLag: 20, maxErrorsPerMinute: 10, heartbeatTimeoutSeconds: 15, maxQueueDepth: 1000, maxQueuedAgeSeconds: 20, recoverySuccessCount: 3 });

    assert.equal(decision.allowed, false);
    assert.ok(decision.reason?.includes('oldest queued'));
  }
);

test(
  'circuit breaker tracks decisions',
  async () => {
    const { ProviderCircuitBreaker } = await import('../sniper/provider-circuit-breaker.js');
    const breaker = new ProviderCircuitBreaker();

    const baseSnapshot = {
      providerName: 'test',
      state: 'healthy' as const,
      lastEventSlot: 100,
      lastEventTime: new Date().toISOString(),
      currentChainSlot: 101,
      slotLag: 1,
      reconnectCount: 0,
      errorsInWindow: 0,
      queueDepth: 5,
      oldestQueuedAgeMs: null,
      droppedDuplicates: 0,
      rejectedOverflow: 0,
      processingLatencyMs: 10,
      p50LatencyMs: 10,
      p95LatencyMs: 20,
      p99LatencyMs: 30,
      snapshotAt: new Date().toISOString(),
    };

    await breaker.shouldAccept(baseSnapshot, { maxSlotLag: 20, maxErrorsPerMinute: 10, heartbeatTimeoutSeconds: 15, maxQueueDepth: 1000, maxQueuedAgeSeconds: 20, recoverySuccessCount: 3 });
    await breaker.shouldAccept(baseSnapshot, { maxSlotLag: 20, maxErrorsPerMinute: 10, heartbeatTimeoutSeconds: 15, maxQueueDepth: 1000, maxQueuedAgeSeconds: 20, recoverySuccessCount: 3 });

    assert.equal(breaker.getDecisions().length, 2);
  }
);