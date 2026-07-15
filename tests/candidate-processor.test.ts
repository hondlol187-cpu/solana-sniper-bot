import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseCandidateEvent,
  dedupKeyForEvent,
} from '../sniper/candidate-processor.js';

test(
  'processor: parse raydium event',
  () => {
    const raw = {
      source: 'raydium',
      signal: {
        signature: 'sigABC',
        slot: 123,
        programId: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
        detectedAt: '2025-01-01T00:00:00Z',
        validated: false,
      },
    };

    const parsed = parseCandidateEvent(raw);

    assert.ok(parsed);
    assert.equal(parsed?.source, 'raydium');
  }
);

test(
  'processor: parse pumpfun event',
  () => {
    const raw = {
      source: 'pumpfun',
      signal: {
        source: 'pumpfun',
        signature: 'sigPUMP',
        slot: 456,
        mint: 'MintAddr',
        creator: 'CreatorAddr',
        detectedAt: '2025-01-01T00:00:00Z',
      },
    };

    const parsed = parseCandidateEvent(raw);

    assert.ok(parsed);
    assert.equal(parsed?.source, 'pumpfun');
  }
);

test(
  'processor: null for invalid event',
  () => {
    assert.equal(
      parseCandidateEvent(null),
      null
    );

    assert.equal(
      parseCandidateEvent({}),
      null
    );

    assert.equal(
      parseCandidateEvent({
        source: 'unknown',
        signal: {},
      }),
      null
    );
  }
);

test(
  'processor: dedup key is deterministic',
  () => {
    const raydiumEvent = {
      source: 'raydium' as const,
      signal: {
        signature: 'sigDET',
        slot: 1,
        programId: 'prog',
        detectedAt: '2025-01-01T00:00:00Z',
        validated: false,
      },
    };

    const key1 =
      dedupKeyForEvent(raydiumEvent);
    const key2 =
      dedupKeyForEvent(raydiumEvent);

    assert.equal(key1, key2);
    assert.ok(key1.startsWith('raydium:'));
  }
);