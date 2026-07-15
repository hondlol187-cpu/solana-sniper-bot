import assert from 'node:assert/strict';
import test from 'node:test';

import { LatencyTracker } from '../sniper/latency-metrics.js';

test(
  'latency metrics: per-stage timing capture',
  () => {
    const tracker = new LatencyTracker();

    tracker.recordDetection(10);
    tracker.recordDetection(20);

    tracker.recordDecode(5);

    tracker.recordValidation(50);
    tracker.recordValidation(100);

    tracker.recordPromotion(30);

    const summary = tracker.getSummary();

    assert.equal(
      summary.avgDetectionMs,
      15
    );

    assert.equal(
      summary.avgDecodeMs,
      5
    );

    assert.equal(
      summary.avgValidationMs,
      75
    );

    assert.equal(
      summary.avgPromotionMs,
      30
    );

    assert.equal(
      summary.totalAvgMs,
      125
    );

    assert.equal(
      summary.sampleCount,
      6
    );
  }
);

test(
  'latency metrics: empty tracker returns zero',
  () => {
    const tracker = new LatencyTracker();

    const summary = tracker.getSummary();

    assert.equal(
      summary.avgDetectionMs,
      0
    );

    assert.equal(
      summary.sampleCount,
      0
    );
  }
);

test(
  'latency metrics: clear resets all',
  () => {
    const tracker = new LatencyTracker();

    tracker.recordDetection(100);

    tracker.clear();

    const summary = tracker.getSummary();

    assert.equal(
      summary.sampleCount,
      0
    );
  }
);