import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'pipeline health evaluates multiple providers',
  async () => {
    const { PipelineHealthManager } = await import('../sniper/pipeline-health.js');

    const manager = new PipelineHealthManager();
    const raydium = manager.registerProvider('raydium');
    const pumpfun = manager.registerProvider('pumpfun');

    raydium.setCurrentChainSlot(100);
    raydium.recordEvent(99);
    raydium.recordLatency(5);

    pumpfun.setCurrentChainSlot(100);
    pumpfun.recordEvent(98);
    pumpfun.recordLatency(8);

    const summary = await manager.evaluatePipeline();

    assert.equal(summary.providers.length, 2);
    assert.equal(summary.providers[0].providerName, 'raydium');
    assert.equal(summary.providers[1].providerName, 'pumpfun');
    assert.ok(summary.totalQueued >= 0);
  }
);

test(
  'pipeline detects and reports unhealthy provider',
  async () => {
    const { PipelineHealthManager } = await import('../sniper/pipeline-health.js');

    const manager = new PipelineHealthManager({ maxErrorsPerMinute: 3 });
    const badProvider = manager.registerProvider('bad');

    badProvider.setCurrentChainSlot(100);
    for (let i = 0; i < 5; i++) badProvider.recordError();

    const summary = await manager.evaluatePipeline();

    const badSnapshot = summary.providers.find(p => p.providerName === 'bad');
    assert.ok(badSnapshot);
    assert.equal(badSnapshot!.state, 'open');

    const badDecision = summary.circuitDecisions.find(d => d.previousState === 'open');
    assert.ok(badDecision);
    assert.equal(badDecision!.allowed, false);
  }
);