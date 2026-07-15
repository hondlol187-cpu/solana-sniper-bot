import assert from 'node:assert/strict';
import test from 'node:test';

import { CandidateQueue } from '../sniper/candidate-queue.js';

test(
  'dedup behavior: same event rejected',
  () => {
    const queue = new CandidateQueue(
      100,
      (e: { id: string }) => e.id
    );

    const event = { id: 'sig-abc' };

    assert.equal(
      queue.enqueue(event),
      true
    );
    assert.equal(
      queue.enqueue(event),
      false
    );

    const metrics = queue.getMetrics();

    assert.equal(
      metrics.duplicates,
      1
    );
  }
);

test(
  'queue overflow policy: drops oldest',
  () => {
    const queue = new CandidateQueue(
      3,
      (e: { id: string }) => e.id
    );

    queue.enqueue({ id: 'a' });
    queue.enqueue({ id: 'b' });
    queue.enqueue({ id: 'c' });
    queue.enqueue({ id: 'd' });

    const metrics = queue.getMetrics();

    assert.equal(
      metrics.overflowCount,
      1
    );
    assert.equal(metrics.dropped, 1);
    assert.equal(
      metrics.currentSize,
      3
    );
  }
);

test(
  'controlled concurrency',
  () => {
    const queue = new CandidateQueue(
      100,
      (e: { id: string }) => e.id,
      2
    );

    queue.enqueue({ id: 'a' });
    queue.enqueue({ id: 'b' });

    const first = queue.dequeue();
    const second = queue.dequeue();
    const third = queue.dequeue();

    assert.ok(first);
    assert.ok(second);
    assert.equal(third, undefined);
  }
);

test(
  'per-stage timing capture',
  () => {
    const queue = new CandidateQueue(
      100,
      (e: { id: string }) => e.id
    );

    queue.enqueue({ id: 'timing-test' });

    const item = queue.dequeue();

    assert.ok(item);

    queue.markProcessed(item, 42);

    const metrics = queue.getMetrics();

    assert.equal(metrics.processed, 1);
    assert.equal(
      metrics.avgProcessMs,
      42
    );
  }
);

test(
  'stable ordering where required',
  () => {
    const queue = new CandidateQueue(
      100,
      (e: { id: string }) => e.id
    );

    queue.enqueue({ id: 'first' });
    queue.enqueue({ id: 'second' });
    queue.enqueue({ id: 'third' });

    const d1 = queue.dequeue();
    const d2 = queue.dequeue();
    const d3 = queue.dequeue();

    assert.equal(d1?.event.id, 'first');
    assert.equal(d2?.event.id, 'second');
    assert.equal(d3?.event.id, 'third');
  }
);