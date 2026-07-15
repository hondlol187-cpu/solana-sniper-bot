import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'cache stores and retrieves risk entries',
  async () => {
    const { RiskCache } = await import('../sniper/risk-cache.js');

    const cache = new RiskCache();

    cache.set(
      'Mint1111111111111111111111111111111',
      'allow',
      {
        mintAddress: 'Mint1111111111111111111111111111111',
        sources: [],
        assessedAt: new Date().toISOString(),
        reportHash: 'abc',
      },
      60
    );

    const entry = cache.get('Mint1111111111111111111111111111111');
    assert.ok(entry);
    assert.equal(entry!.decision, 'allow');
    assert.equal(entry!.hits, 1);
  }
);

test(
  'cache expires entries after TTL',
  async () => {
    const { RiskCache } = await import('../sniper/risk-cache.js');

    const cache = new RiskCache();

    cache.set(
      'Mint2222222222222222222222222222222',
      'allow',
      {
        mintAddress: 'Mint2222222222222222222222222222222',
        sources: [],
        assessedAt: new Date().toISOString(),
        reportHash: 'def',
      },
      0 // Immediate expiry
    );

    // Small delay to ensure TTL check
    await new Promise(resolve => setTimeout(resolve, 10));

    const entry = cache.get('Mint2222222222222222222222222222222');
    assert.equal(entry, null);
  }
);

test(
  'cache invalidates on hash change',
  async () => {
    const { RiskCache } = await import('../sniper/risk-cache.js');

    const cache = new RiskCache();

    cache.set(
      'Mint3333333333333333333333333333333',
      'allow',
      {
        mintAddress: 'Mint3333333333333333333333333333333',
        sources: [],
        assessedAt: new Date().toISOString(),
        reportHash: 'old_hash',
      },
      60
    );

    const invalidated = cache.invalidateIfHashChanged(
      'Mint3333333333333333333333333333333',
      'new_hash'
    );

    assert.equal(invalidated, true);
    assert.equal(cache.get('Mint3333333333333333333333333333333'), null);
  }
);

test(
  'cache evicts oldest entries when full',
  async () => {
    const { RiskCache } = await import('../sniper/risk-cache.js');

    const cache = new RiskCache(5, 60);

    for (let i = 0; i < 10; i++) {
      cache.set(
        `Mint${i.toString().padStart(40, '0')}`,
        'allow',
        {
          mintAddress: `Mint${i.toString().padStart(40, '0')}`,
          sources: [],
          assessedAt: new Date().toISOString(),
          reportHash: `hash${i}`,
        },
        60
      );
    }

    // Cache should have evicted some entries
    assert.ok(cache.size() <= 5);
  }
);

test(
  'cache stats track hits',
  async () => {
    const { RiskCache } = await import('../sniper/risk-cache.js');

    const cache = new RiskCache();

    cache.set(
      'Mint4444444444444444444444444444444444',
      'allow',
      {
        mintAddress: 'Mint4444444444444444444444444444444444',
        sources: [],
        assessedAt: new Date().toISOString(),
        reportHash: 'stats_hash',
      },
      60
    );

    cache.get('Mint4444444444444444444444444444444444');
    cache.get('Mint4444444444444444444444444444444444');
    cache.get('Mint4444444444444444444444444444444444');

    const stats = cache.getStats();
    assert.equal(stats.totalHits, 3);
    assert.equal(stats.entries, 1);
  }
);