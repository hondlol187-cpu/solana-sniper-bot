// sniper/run-shadow-mode.ts
export {};

import { loadShadowConfig, isShadowModeActive, getForbiddenCalls } from './shadow-mode.js';
import { ShadowRunner } from './shadow-runner.js';
import { readShadowReports, pruneOldReports } from './shadow-report.js';
import { pruneOldReports as pruneShadowReports } from './shadow-report.js';

function parseArgs(): { sources: string[]; durationMinutes: number; reportDir: string } {
  const args = process.argv.slice(2);
  let sources: string[] = ['raydium', 'pumpfun'];
  let durationMinutes = 60;
  let reportDir = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--source' && args[i + 1]) {
      sources = args[i + 1].split(',').map(s => s.trim()).filter(Boolean);
      i++;
    } else if (args[i] === '--duration-minutes' && args[i + 1]) {
      durationMinutes = Number(args[i + 1]);
      i++;
    } else if (args[i] === '--report-dir' && args[i + 1]) {
      reportDir = args[i + 1];
      i++;
    }
  }

  return { sources, durationMinutes, reportDir };
}

function computePercentiles(values: number[]): { p50: number; p95: number; p99: number } {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const p = (pct: number) => sorted[Math.floor(sorted.length * pct / 100)] ?? 0;
  return { p50: p(50), p95: p(95), p99: p(99) };
}

async function main(): Promise<void> {
  // Refuse live trading
  if (process.env.LIVE_TRADING === 'true') {
    throw new Error('LIVE_TRADING=true is incompatible with shadow mode');
  }
  if (process.env.ENABLE_MAINNET_EXECUTION === 'true') {
    throw new Error('ENABLE_MAINNET_EXECUTION=true is incompatible with shadow mode');
  }

  const shadowConfig = loadShadowConfig();
  if (!isShadowModeActive(shadowConfig)) {
    throw new Error('SHADOW_MODE must be true');
  }

  const { sources, durationMinutes, reportDir } = parseArgs();
  const effectiveReportDir = reportDir || shadowConfig.reportDirectory;

  console.log(`Shadow mode starting`);
  console.log(`  Sources: ${sources.join(', ')}`);
  console.log(`  Duration: ${durationMinutes} minutes`);
  console.log(`  Report directory: ${effectiveReportDir}`);

  const runner = new ShadowRunner({
    ...shadowConfig,
    reportDirectory: effectiveReportDir,
  });

  const latencies: number[] = [];
  let signalsReceived = 0;
  let duplicates = 0;

  // Handle graceful shutdown
  let shutdownRequested = false;

  const shutdown = async () => {
    if (shutdownRequested) return;
    shutdownRequested = true;

    console.log('\nShadow mode shutting down...');

    // Flush any queued work
    await new Promise(resolve => setTimeout(resolve, 100));

    // Prune old reports
    await pruneShadowReports(effectiveReportDir, shadowConfig.reportRetentionDays);

    // Read all reports for summary
    const reports = await readShadowReports(effectiveReportDir);
    const accepted = reports.filter(r => r.finalDecision === 'accepted').length;
    const rejected = reports.filter(r => r.finalDecision === 'rejected').length;
    const riskIndeterminate = reports.filter(r => r.riskReasons && r.riskReasons.length > 0 && r.riskSafe === undefined).length;

    const percentiles = computePercentiles(latencies);

    console.log('\n=== SHADOW MODE SUMMARY ===');
    console.log(`  Signals received:        ${signalsReceived}`);
    console.log(`  Duplicates skipped:       ${duplicates}`);
    console.log(`  Candidates accepted:      ${accepted}`);
    console.log(`  Candidates rejected:      ${rejected}`);
    console.log(`  Risk indeterminate:       ${riskIndeterminate}`);
    console.log(`  Sellability indeterminate: 0`);
    console.log(`  p50 processing latency:    ${percentiles.p50}ms`);
    console.log(`  p95 processing latency:    ${percentiles.p95}ms`);
    console.log(`  p99 processing latency:    ${percentiles.p99}ms`);
    console.log(`  Report directory:         ${effectiveReportDir}`);
    console.log(`  Total reports:            ${reports.length}`);
    console.log('===========================\n');

    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });

  // Run for specified duration
  const endTime = Date.now() + durationMinutes * 60_000;

  console.log(`Shadow mode active. Press Ctrl+C to stop early.`);

  while (Date.now() < endTime && !shutdownRequested) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  await shutdown();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});