import assert from 'node:assert/strict';
import test from 'node:test';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

test(
  'shadow runner processes accepted candidate',
  async () => {
    const { ShadowRunner } = await import('../sniper/shadow-runner.js');
    const { readShadowReports } = await import('../sniper/shadow-report.js');

    const reportDir = await mkdtemp(join(tmpdir(), 'shadow-runner-test-'));

    try {
      const runner = new ShadowRunner({
        enabled: true,
        reportDirectory: reportDir,
        maxCandidatesPerHour: 1000,
        reportRetentionDays: 14,
      });

      const result = await runner.processCandidate(
        {
          source: 'pumpfun',
          signal: {
            source: 'pumpfun',
            signature: 'test_sig_abc123def456',
            slot: 250000000,
            mint: 'MintAddress1111111111111111111111111111',
            creator: 'CreatorAddress11111111111111111111',
            detectedAt: new Date().toISOString(),
          },
        },
        {
          riskResult: {
            safe: true,
            score: 10,
            hardReject: false,
            reasons: [],
            warnings: [],
            metrics: {
              topHolderPercent: 5,
              lpLocked: true,
              lpBurned: false,
              knownDeployerRisk: 'low',
            },
          },
          sellabilityResult: {
            sellable: true,
            hardReject: false,
            reasons: [],
            warnings: [],
          },
          routeResult: 'jupiter',
          proposedAmount: '100000',
          decodeLatencyMs: 5,
          validationLatencyMs: 12,
          detectionSlot: 250000000,
          pool: 'PoolAddress111111111111111111111111111',
        }
      );

      assert.equal(result.finalDecision, 'accepted');
      assert.equal(result.mint, 'MintAddress1111111111111111111111111111');
      assert.equal(result.source, 'pumpfun');
      assert.ok(result.processingLatencyMs >= 0);

      const metrics = runner.getMetrics();
      assert.equal(metrics.totalProcessed, 1);
      assert.equal(metrics.accepted, 1);
      assert.equal(metrics.rejected, 0);

      // Verify report was written
      const reports = await readShadowReports(reportDir);
      assert.equal(reports.length, 1);
      assert.equal(reports[0].finalDecision, 'accepted');
    } finally {
      await rm(reportDir, { force: true, recursive: true });
    }
  }
);

test(
  'shadow runner rejects high-risk candidate',
  async () => {
    const { ShadowRunner } = await import('../sniper/shadow-runner.js');

    const reportDir = await mkdtemp(join(tmpdir(), 'shadow-runner-reject-'));

    try {
      const runner = new ShadowRunner({
        enabled: true,
        reportDirectory: reportDir,
        maxCandidatesPerHour: 1000,
        reportRetentionDays: 14,
      });

      const result = await runner.processCandidate(
        {
          source: 'pumpfun',
          signal: {
            source: 'pumpfun',
            signature: 'test_sig_rejected001',
            slot: 250000001,
            mint: 'RiskyMint2222222222222222222222222222',
            creator: 'BadCreator33333333333333333333333333',
            detectedAt: new Date().toISOString(),
          },
        },
        {
          riskResult: {
            safe: false,
            score: 95,
            hardReject: true,
            reasons: ['Top holder owns 60% of supply'],
            warnings: [],
            metrics: {
              topHolderPercent: 60,
              lpLocked: false,
              lpBurned: false,
              knownDeployerRisk: 'high',
            },
          },
          decodeLatencyMs: 3,
          validationLatencyMs: 8,
          detectionSlot: 250000001,
        }
      );

      assert.equal(result.finalDecision, 'rejected');
      assert.ok(result.rejectionReasons.length > 0);
      assert.ok(result.rejectionReasons.some(r => r.includes('60%')));

      const metrics = runner.getMetrics();
      assert.equal(metrics.rejected, 1);
    } finally {
      await rm(reportDir, { force: true, recursive: true });
    }
  }
);

test(
  'shadow runner rejects unsellable candidate',
  async () => {
    const { ShadowRunner } = await import('../sniper/shadow-runner.js');

    const reportDir = await mkdtemp(join(tmpdir(), 'shadow-runner-unsell-'));

    try {
      const runner = new ShadowRunner({
        enabled: true,
        reportDirectory: reportDir,
        maxCandidatesPerHour: 1000,
        reportRetentionDays: 14,
      });

      const result = await runner.processCandidate(
        {
          source: 'raydium',
          signal: {
            signature: 'test_sig_unsellable',
            slot: 250000002,
            baseMint: 'HoneypotMint444444444444444444444',
            poolAddress: 'PoolAddress00000000000000000000001',
            quoteMint: 'So11111111111111111111111111111111',
            baseReserves: '1000000000',
            quoteReserves: '10000000000',
            liquiditySol: 10,
            validated: true,
            detectedAt: new Date().toISOString(),
          } as any,
        },
        {
          riskResult: {
            safe: true,
            score: 15,
            hardReject: false,
            reasons: [],
            warnings: [],
            metrics: {
              topHolderPercent: 8,
              lpLocked: true,
              lpBurned: false,
              knownDeployerRisk: 'low',
            },
          },
          sellabilityResult: {
            sellable: false,
            hardReject: true,
            reasons: ['No sell route found for this token'],
            warnings: [],
          },
          decodeLatencyMs: 4,
          validationLatencyMs: 6,
          detectionSlot: 250000002,
          pool: 'PoolAddress00000000000000000000001',
        }
      );

      assert.equal(result.finalDecision, 'rejected');
      assert.ok(
        result.rejectionReasons.some(r => r.includes('No sell route'))
      );
    } finally {
      await rm(reportDir, { force: true, recursive: true });
    }
  }
);

test(
  'shadow runner throws when disabled',
  async () => {
    const { ShadowRunner } = await import('../sniper/shadow-runner.js');

    try {
      new ShadowRunner({
        enabled: false,
        reportDirectory: '/tmp/test',
        maxCandidatesPerHour: 1000,
        reportRetentionDays: 14,
      });

      assert.fail('Should have thrown');
    } catch (error) {
      assert.ok(
        error instanceof Error && error.message.includes('not active'),
        `Expected "not active" error, got: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
);

test(
  'shadow report sanitizes secrets',
  async () => {
    const { recordShadowReport, readShadowReports } = await import('../sniper/shadow-report.js');

    const reportDir = await mkdtemp(join(tmpdir(), 'shadow-sanitize-'));

    try {
      // Create a result with a field name that looks like a secret
      const maliciousResult: any = {
        source: 'pumpfun',
        sourceEventId: 'test_sig_sanit001',
        mint: 'SanitizeMint55555555555555555555555',
        detectionTime: new Date().toISOString(),
        decodeLatencyMs: 1,
        validationLatencyMs: 1,
        finalDecision: 'rejected',
        rejectionReasons: [],
        processingLatencyMs: 2,
        // Inject a secret field
        secret: 'my_private_key_value',
        api_key: 'sk-live-12345',
      };

      await assert.rejects(
        () => recordShadowReport(reportDir, maliciousResult),
        /potential secret field/
      );
    } finally {
      await rm(reportDir, { force: true, recursive: true });
    }
  }
);