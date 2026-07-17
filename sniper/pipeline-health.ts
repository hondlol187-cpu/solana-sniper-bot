// sniper/pipeline-health.ts
import { ProviderHealthTracker } from './provider-health.js';
import { ProviderCircuitBreaker } from './provider-circuit-breaker.js';
import type { ProviderHealthConfig, ProviderHealthSnapshot } from './provider-health.js';
import type { CircuitBreakerConfig, CircuitBreakerDecision } from './provider-circuit-breaker.js';

export interface PipelineHealthSummary {
  providers: ProviderHealthSnapshot[];
  circuitDecisions: CircuitBreakerDecision[];
  totalQueued: number;
  totalDropped: number;
  timestamp: string;
}

export class PipelineHealthManager {
  private providers = new Map<string, ProviderHealthTracker>();
  private circuitBreaker = new ProviderCircuitBreaker();
  private healthConfig: ProviderHealthConfig;
  private circuitConfig: CircuitBreakerConfig;

  constructor(
    healthConfig?: Partial<ProviderHealthConfig>,
    circuitConfig?: Partial<CircuitBreakerConfig>
  ) {
    this.healthConfig = {
      maxSlotLag: 20,
      maxErrorsPerMinute: 10,
      heartbeatTimeoutSeconds: 15,
      maxCandidateQueueDepth: 1000,
      maxQueuedCandidateAgeSeconds: 20,
      circuitRecoverySuccessCount: 3,
      latencyWindowSamples: 100,
      ...healthConfig,
    };
    this.circuitConfig = {
      maxSlotLag: 20,
      maxErrorsPerMinute: 10,
      heartbeatTimeoutSeconds: 15,
      maxQueueDepth: 1000,
      maxQueuedAgeSeconds: 20,
      recoverySuccessCount: 3,
      ...circuitConfig,
    };
  }

  registerProvider(name: string): ProviderHealthTracker {
    const tracker = new ProviderHealthTracker(name, this.healthConfig);
    this.providers.set(name, tracker);
    return tracker;
  }

  getProvider(name: string): ProviderHealthTracker | undefined {
    return this.providers.get(name);
  }

  async evaluatePipeline(): Promise<PipelineHealthSummary> {
    const snapshots: ProviderHealthSnapshot[] = [];
    const decisions: CircuitBreakerDecision[] = [];
    let totalQueued = 0;
    let totalDropped = 0;

    for (const [name, tracker] of this.providers) {
      tracker.evaluate();
      const snapshot = tracker.getSnapshot(name);
      snapshots.push(snapshot);

      const decision = await this.circuitBreaker.shouldAccept(snapshot, this.circuitConfig);
      decisions.push(decision);

      totalQueued += snapshot.queueDepth;
      totalDropped += snapshot.droppedDuplicates + snapshot.rejectedOverflow;
    }

    return {
      providers: snapshots,
      circuitDecisions: decisions,
      totalQueued,
      totalDropped,
      timestamp: new Date().toISOString(),
    };
  }

  getCircuitBreaker(): ProviderCircuitBreaker {
    return this.circuitBreaker;
  }
}