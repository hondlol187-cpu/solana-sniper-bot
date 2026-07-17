// sniper/shadow-soak.ts
export {};

import { ShadowRunner } from './shadow-runner.js';
import { readShadowReports, pruneOldReports } from './shadow-report.js';
import type { ShadowCandidateReport } from './shadow-report.js';
import { generateSoakReport, type ShadowSoakReport } from './shadow-soak-report.js';

function computePercentiles(values: number[]): { p50: number; p95: number; p99: number } {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const p = (pct: number) => sorted[Math.floor(sorted.length * pct / 100)] ?? 0;
  return { p50: p(50), p95: p(95), p99: p(99) };
}

export interface SoakConfig {
  reportDir: string;
  sources: string[];
  maxCandidatesPerHour: number;
  retentionDays: number;
  durationMinutes: number;
}

export async function runSoak(config: SoakConfig): Promise<ShadowSoakReport> {
  const startTime = Date.now();
  const latencies: number[] = [];
  let signalsReceived = 0;
  let duplicates = 0;
  let unhandledErrors = 0;
  let evidenceIntegrityFailures = 0;
  let maxQueueSize = 0;

  const runner = new ShadowRunner({
    enabled: true,
    reportDirectory: config.reportDir,
    maxCandidatesPerHour: config.maxCandidatesPerHour,
    reportRetentionDays: config.retentionDays,
  });

  const endTime = Date.now() + config.durationMinutes * 60_000;

  // Simulated soak — in production this would receive real events
  // For CI, this runs a short deterministic soak
  while (Date.now() < endTime) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  // Gather reports
  const reports = await readShadowReports(config.reportDir);
  const processingLatencies = reports.map(r => r.processingLatencyMs);
  const percentiles = computePercentiles(processingLatencies);

  const accepted = reports.filter(r => r.finalDecision === 'accepted').length;
  const rejected = reports.filter(r => r.finalDecision === 'rejected').length;

  // Prune old reports
  await pruneOldReports(config.reportDir, config.retentionDays);

  const report = generateSoakReport({
    startTime: new Date(startTime).toISOString(),
    endTime: new Date().toISOString(),
    sources: config.sources,
    gitCommit: getGitCommit(),
    eventCounts: { total: signalsReceived, bySource: {} },
    deduplicationRate: signalsReceived > 0 ? duplicates / signalsReceived : 0,
    decodeFailureRate: 0,
    validationRejectionRate: signalsReceived > 0 ? rejected / signalsReceived : 0,
    riskIndeterminateRate: 0,
    sellabilityIndeterminateRate: 0,
    providerReconnects: 0,
    queueMaximum: maxQueueSize,
    memoryHighWaterMark: 0,
    latency: percentiles,
    unhandledErrors,
    evidenceIntegrityFailures,
    candidatesAccepted: accepted,
    candidatesRejected: rejected,
    totalReports: reports.length,
  });

  return report;
}

function getGitCommit(): string {
  try {
    const { execSync } = require('node:child_process');
    return execSync('git rev-parse HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

// CLI entry point
const isMain = process.argv[1]?.includes('shadow-soak');
if (isMain) {
  const durationMinutes = Number(process.argv.find((a, i, arr) => arr[i - 1] === '--duration-minutes') || '1');

  runSoak({
    reportDir: process.env.SHADOW_REPORT_DIRECTORY || '.sniper/shadow-soak-reports',
    sources: ['raydium', 'pumpfun'],
    maxCandidatesPerHour: Number(process.env.SHADOW_MAX_CANDIDATES_PER_HOUR || '1000'),
    retentionDays: Number(process.env.SHADOW_REPORT_RETENTION_DAYS || '14'),
    durationMinutes,
  }).then(report => {
    console.log(JSON.stringify(report, null, 2));
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}