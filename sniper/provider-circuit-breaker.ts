// sniper/provider-circuit-breaker.ts
import type { ProviderState, ProviderHealthSnapshot } from './provider-health.js';
import type { AuditFn } from './audit.js';

export interface CircuitBreakerConfig {
  maxSlotLag: number;
  maxErrorsPerMinute: number;
  heartbeatTimeoutSeconds: number;
  maxQueueDepth: number;
  maxQueuedAgeSeconds: number;
  recoverySuccessCount: number;
}

export interface CircuitBreakerDecision {
  allowed: boolean;
  reason?: string;
  previousState: ProviderState;
}

export class ProviderCircuitBreaker {
  private decisions: CircuitBreakerDecision[] = [];
  private auditFn?: AuditFn;

  constructor(auditFn?: AuditFn) {
    this.auditFn = auditFn;
  }

  async shouldAccept(
    snapshot: ProviderHealthSnapshot,
    config: CircuitBreakerConfig
  ): Promise<CircuitBreakerDecision> {
    const previousState = snapshot.state;
    let allowed = true;
    let reason: string | undefined;

    if (snapshot.state === 'open') {
      allowed = false;
      reason = `Provider ${snapshot.providerName} circuit is open`;
    } else if (snapshot.state === 'recovering') {
      allowed = true;
      reason = `Provider ${snapshot.providerName} is in recovery — accepting with caution`;
    } else if (snapshot.state === 'stopped') {
      allowed = false;
      reason = `Provider ${snapshot.providerName} is stopped`;
    }

    // Metric-based checks only apply if not already rejected by state
    if (allowed) {
      // Check slot lag
      if (snapshot.slotLag !== null && snapshot.slotLag > config.maxSlotLag) {
        allowed = false;
        reason = `Provider ${snapshot.providerName} slot lag ${snapshot.slotLag} exceeds ${config.maxSlotLag}`;
      }

      // Check queue depth
      if (allowed && snapshot.queueDepth > config.maxQueueDepth) {
        allowed = false;
        reason = `Provider ${snapshot.providerName} queue depth ${snapshot.queueDepth} exceeds ${config.maxQueueDepth}`;
      }

      // Check stale queued candidates
      if (allowed && snapshot.oldestQueuedAgeMs !== null) {
        const ageSeconds = snapshot.oldestQueuedAgeMs / 1000;
        if (ageSeconds > config.maxQueuedAgeSeconds) {
          allowed = false;
          reason = `Provider ${snapshot.providerName} oldest queued candidate ${Math.round(ageSeconds)}s exceeds ${config.maxQueuedAgeSeconds}s`;
        }
      }
    }

    const decision: CircuitBreakerDecision = { allowed, reason, previousState };
    this.decisions.push(decision);

    if (!allowed && this.auditFn) {
      try {
        await this.auditFn('circuit-breaker.rejected', {
          provider: snapshot.providerName,
          reason,
          state: snapshot.state,
        });
      } catch { /* audit not available */ }
    }

    return decision;
  }

  getDecisions(): CircuitBreakerDecision[] {
    return [...this.decisions];
  }

  reset(): void {
    this.decisions = [];
  }
}