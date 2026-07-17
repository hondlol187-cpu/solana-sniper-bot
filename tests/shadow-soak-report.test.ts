import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'generateSoakReport produces valid report structure',
  async () => {
    const { generateSoakReport } = await import('../sniper/shadow-soak-report.js');

    const report = generateSoakReport({
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-01-01T01:00:00Z',
      sources: ['raydium', 'pumpfun'],
      gitCommit: 'abc123',
      eventCounts: { total: 100, bySource: { raydium: 60, pumpfun: 40 } },
      deduplicationRate: 0.1,
      decodeFailureRate: 0.05,
      validationRejectionRate: 0.3,
      riskIndeterminateRate: 0.02,
      sellabilityIndeterminateRate: 0.01,
      providerReconnects: 2,
      queueMaximum: 50,
      memoryHighWaterMark: 100_000_000,
      latency: { p50: 15, p95: 45, p99: 120 },
      unhandledErrors: 0,
      evidenceIntegrityFailures: 0,
      candidatesAccepted: 50,
      candidatesRejected: 30,
      totalReports: 80,
    });

    assert.equal(report.version, 1);
    assert.equal(report.gitCommit, 'abc123');
    assert.equal(report.eventCounts.total, 100);
    assert.ok(report.acceptanceCriteria.zeroUnhandledErrors);
    assert.ok(report.acceptanceCriteria.boundedMemoryGrowth);
  }
);

test(
  'validateSoakAcceptance passes when all criteria met',
  async () => {
    const { generateSoakReport, validateSoakAcceptance } = await import('../sniper/shadow-soak-report.js');

    const report = generateSoakReport({
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-01-01T01:00:00Z',
      sources: ['raydium'],
      gitCommit: 'abc123',
      eventCounts: { total: 10, bySource: {} },
      deduplicationRate: 0,
      decodeFailureRate: 0,
      validationRejectionRate: 0,
      riskIndeterminateRate: 0,
      sellabilityIndeterminateRate: 0,
      providerReconnects: 0,
      queueMaximum: 0,
      memoryHighWaterMark: 0,
      latency: { p50: 0, p95: 0, p99: 0 },
      unhandledErrors: 0,
      evidenceIntegrityFailures: 0,
      candidatesAccepted: 0,
      candidatesRejected: 0,
      totalReports: 0,
    });

    const result = validateSoakAcceptance(report);
    assert.equal(result.passed, true);
    assert.equal(result.failures.length, 0);
  }
);

test(
  'validateSoakAcceptance fails when errors present',
  async () => {
    const { generateSoakReport, validateSoakAcceptance } = await import('../sniper/shadow-soak-report.js');

    const report = generateSoakReport({
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-01-01T01:00:00Z',
      sources: ['raydium'],
      gitCommit: 'abc123',
      eventCounts: { total: 10, bySource: {} },
      deduplicationRate: 0,
      decodeFailureRate: 0,
      validationRejectionRate: 0,
      riskIndeterminateRate: 0,
      sellabilityIndeterminateRate: 0,
      providerReconnects: 0,
      queueMaximum: 0,
      memoryHighWaterMark: 0,
      latency: { p50: 0, p95: 0, p99: 0 },
      unhandledErrors: 3,
      evidenceIntegrityFailures: 1,
      candidatesAccepted: 0,
      candidatesRejected: 0,
      totalReports: 0,
    });

    const result = validateSoakAcceptance(report);
    assert.equal(result.passed, false);
    assert.ok(result.failures.length >= 2);
  }
);

test(
  'soak report includes latency percentiles',
  async () => {
    const { generateSoakReport } = await import('../sniper/shadow-soak-report.js');

    const report = generateSoakReport({
      startTime: '2025-01-01T00:00:00Z',
      endTime: '2025-01-01T01:00:00Z',
      sources: ['raydium'],
      gitCommit: 'abc',
      eventCounts: { total: 0, bySource: {} },
      deduplicationRate: 0, decodeFailureRate: 0, validationRejectionRate: 0,
      riskIndeterminateRate: 0, sellabilityIndeterminateRate: 0,
      providerReconnects: 0, queueMaximum: 0, memoryHighWaterMark: 0,
      latency: { p50: 12, p95: 89, p99: 234 },
      unhandledErrors: 0, evidenceIntegrityFailures: 0,
      candidatesAccepted: 0, candidatesRejected: 0, totalReports: 0,
    });

    assert.equal(report.latency.p50, 12);
    assert.equal(report.latency.p95, 89);
    assert.equal(report.latency.p99, 234);
  }
);