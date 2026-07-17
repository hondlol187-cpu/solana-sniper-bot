// sniper/shadow-runner.ts
import type { ShadowModeConfig } from './shadow-mode.js';
import type { CandidateEvent } from './candidate-processor.js';
import type { TokenRiskReport } from './token-risk.js';
import type { SellabilityReport } from './verify-sellability.js';
import type { ShadowCandidateReport } from './shadow-report.js';
import { recordShadowReport } from './shadow-report.js';
import { isShadowModeActive } from './shadow-mode.js';

export interface ShadowRunnerMetrics {
  totalProcessed: number;
  accepted: number;
  rejected: number;
  errors: number;
  avgLatencyMs: number;
}

export interface ShadowProcessingResult {
  source: 'raydium' | 'pumpfun';
  sourceEventId: string;
  mint: string;
  creator?: string;
  pool?: string;
  detectionSlot?: number;
  detectionTime: string;
  decodeLatencyMs: number;
  validationLatencyMs: number;
  riskResult?: TokenRiskReport;
  sellabilityResult?: SellabilityReport;
  routeResult?: string;
  proposedAmount?: string;
  finalDecision: 'accepted' | 'rejected';
  rejectionReasons: string[];
  processingLatencyMs: number;
}

export class ShadowRunner {
  private config: ShadowModeConfig;
  private processed = 0;
  private accepted = 0;
  private rejected = 0;
  private errors = 0;
  private totalLatencyMs = 0;
  private hourlyCount = 0;
  private hourlyResetAt = Date.now();

  constructor(config: ShadowModeConfig) {
    if (!isShadowModeActive(config)) {
      throw new Error('Shadow mode is not active');
    }
    this.config = config;
  }

  async processCandidate(
    event: CandidateEvent,
    options: {
      riskResult?: TokenRiskReport;
      sellabilityResult?: SellabilityReport;
      routeResult?: string;
      proposedAmount?: string;
      decodeLatencyMs: number;
      validationLatencyMs: number;
      detectionSlot?: number;
      pool?: string;
    }
  ): Promise<ShadowProcessingResult> {
    const startTime = Date.now();
    this.enforceHourlyLimit();

    const source = event.source;
    const sourceEventId = source === 'raydium'
      ? event.signal.signature
      : event.signal.signature;

    const mint = source === 'raydium'
      ? ((event.signal as unknown) as Record<string, unknown>).baseMint as string ?? 'unknown'
      : event.signal.mint;

    const creator = source === 'raydium'
      ? undefined
      : event.signal.creator;

    const rejectionReasons: string[] = [];
    let finalDecision: 'accepted' | 'rejected' = 'accepted';

    // Evaluate risk
    if (options.riskResult) {
      if (!options.riskResult.safe) {
        finalDecision = 'rejected';
        rejectionReasons.push(...options.riskResult.reasons);
      }
    }

    // Evaluate sellability
    if (options.sellabilityResult) {
      if (!options.sellabilityResult.sellable) {
        finalDecision = 'rejected';
        rejectionReasons.push(...options.sellabilityResult.reasons);
      }
    }

    const processingLatencyMs = Date.now() - startTime;

    const result: ShadowProcessingResult = {
      source,
      sourceEventId,
      mint,
      creator,
      pool: options.pool,
      detectionSlot: options.detectionSlot,
      detectionTime: new Date().toISOString(),
      decodeLatencyMs: options.decodeLatencyMs,
      validationLatencyMs: options.validationLatencyMs,
      riskResult: options.riskResult,
      sellabilityResult: options.sellabilityResult,
      routeResult: options.routeResult,
      proposedAmount: options.proposedAmount,
      finalDecision,
      rejectionReasons,
      processingLatencyMs,
    };

    this.processed++;
    this.totalLatencyMs += processingLatencyMs;

    if (finalDecision === 'accepted') {
      this.accepted++;
    } else {
      this.rejected++;
    }

    // Record report
    await recordShadowReport(this.config.reportDirectory, result);

    return result;
  }

  getMetrics(): ShadowRunnerMetrics {
    return {
      totalProcessed: this.processed,
      accepted: this.accepted,
      rejected: this.rejected,
      errors: this.errors,
      avgLatencyMs: this.processed > 0
        ? Math.round(this.totalLatencyMs / this.processed)
        : 0,
    };
  }

  private enforceHourlyLimit(): void {
    const now = Date.now();
    const hourMs = 3600_000;

    if (now - this.hourlyResetAt >= hourMs) {
      this.hourlyCount = 0;
      this.hourlyResetAt = now;
    }

    this.hourlyCount++;

    if (this.hourlyCount > this.config.maxCandidatesPerHour) {
      throw new Error(
        `Shadow mode hourly limit exceeded: ${this.hourlyCount} > ${this.config.maxCandidatesPerHour}`
      );
    }
  }
}