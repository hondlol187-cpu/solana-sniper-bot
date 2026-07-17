import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test(
  'shadow runner produces reports that can be read after processing',
  async () => {
    const { ShadowRunner } = await import('../sniper/shadow-runner.js');
    const { readShadowReports } = await import('../sniper/shadow-report.js');

    const reportDir = await mkdtemp(join(tmpdir(), 'shadow-shutdown-'));

    try {
      const runner = new ShadowRunner({
        enabled: true,
        reportDirectory: reportDir,
        maxCandidatesPerHour: 1000,
        reportRetentionDays: 14,
      });

      await runner.processCandidate(
        {
          source: 'pumpfun',
          signal: {
            source: 'pumpfun',
            signature: 'shutdown_test_sig_001',
            slot: 260000000,
            mint: 'ShutdownTestMint1111111111111111',
            creator: 'ShutdownCreator111111111111111',
            detectedAt: new Date().toISOString(),
          },
        },
        {
          riskResult: {
            safe: true,
            score: 5,
            hardReject: false,
            reasons: [],
            warnings: [],
            metrics: { topHolderPercent: 3, lpLocked: true, lpBurned: false, knownDeployerRisk: 'low' },
          },
          sellabilityResult: { sellable: true, hardReject: false, reasons: [], warnings: [] },
          routeResult: 'jupiter',
          proposedAmount: '50000',
          decodeLatencyMs: 2,
          validationLatencyMs: 5,
          detectionSlot: 260000000,
        }
      );

      const reports = await readShadowReports(reportDir);
      assert.equal(reports.length, 1, 'Should have exactly 1 report');
      assert.equal(reports[0].finalDecision, 'accepted');
      assert.equal(reports[0].version, 1);

      // Verify no secrets leaked
      const jsonStr = JSON.stringify(reports[0]).toLowerCase();
      assert.ok(!jsonStr.includes('privatekey'), 'Report must not contain privatekey');
      assert.ok(!jsonStr.includes('secret'), 'Report must not contain secret field names');
    } finally {
      await rm(reportDir, { force: true, recursive: true });
    }
  }
);

test(
  'shadow report directory is created if missing',
  async () => {
    const { recordShadowReport, readShadowReports } = await import('../sniper/shadow-report.js');
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const parentDir = await mkdtemp(join(tmpdir(), 'shadow-create-dir-'));
    const newDir = join(parentDir, 'nested', 'reports');

    try {
      // recordShadowReport should create the directory
      await recordShadowReport(newDir, {
        source: 'pumpfun',
        sourceEventId: 'dir_create_sig',
        mint: 'DirCreateMint11111111111111111111',
        detectionTime: new Date().toISOString(),
        decodeLatencyMs: 1,
        validationLatencyMs: 1,
        finalDecision: 'rejected',
        rejectionReasons: ['test'],
        processingLatencyMs: 2,
      });

      const reports = await readShadowReports(newDir);
      assert.equal(reports.length, 1);
    } finally {
      await rm(parentDir, { force: true, recursive: true });
    }
  }
);