// sniper/provider-health.ts
export type ProviderState = 'healthy' | 'degraded' | 'open' | 'recovering' | 'stopped';

export interface ProviderHealthSnapshot {
  providerName: string;
  state: ProviderState;
  lastEventSlot: number | null;
  lastEventTime: string | null;
  currentChainSlot: number;
  slotLag: number | null;
  reconnectCount: number;
  errorsInWindow: number;
  queueDepth: number;
  oldestQueuedAgeMs: number | null;
  droppedDuplicates: number;
  rejectedOverflow: number;
  processingLatencyMs: number | null;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  snapshotAt: string;
}

export interface ProviderHealthConfig {
  maxSlotLag: number;
  maxErrorsPerMinute: number;
  heartbeatTimeoutSeconds: number;
  maxCandidateQueueDepth: number;
  maxQueuedCandidateAgeSeconds: number;
  circuitRecoverySuccessCount: number;
  latencyWindowSamples: number;
}

const DEFAULT_CONFIG: ProviderHealthConfig = {
  maxSlotLag: 20,
  maxErrorsPerMinute: 10,
  heartbeatTimeoutSeconds: 15,
  maxCandidateQueueDepth: 1000,
  maxQueuedCandidateAgeSeconds: 20,
  circuitRecoverySuccessCount: 3,
  latencyWindowSamples: 100,
};

export class ProviderHealthTracker {
  private config: ProviderHealthConfig;
  private state: ProviderState = 'healthy';
  private lastEventSlot: number | null = null;
  private lastEventTime: string | null = null;
  private currentChainSlot = 0;
  private reconnectCount = 0;
  private errorTimestamps: number[] = [];
  private queueDepth = 0;
  private oldestQueuedAt: number | null = null;
  private droppedDuplicates = 0;
  private rejectedOverflow = 0;
  private recoveryProbes = 0;
  private latencies: number[] = [];

  constructor(providerName: string, config?: Partial<ProviderHealthConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  recordEvent(slot: number): void {
    this.lastEventSlot = slot;
    this.lastEventTime = new Date().toISOString();

    if (this.state === 'open' || this.state === 'recovering') {
      this.recoveryProbes++;
      if (this.recoveryProbes >= this.config.circuitRecoverySuccessCount) {
        this.state = 'healthy';
        this.recoveryProbes = 0;
      }
    }
  }

  recordError(): void {
    const now = Date.now();
    this.errorTimestamps.push(now);
    this.pruneOldErrors(now);
  }

  recordReconnect(): void {
    this.reconnectCount++;
  }

  setQueueDepth(depth: number, oldestAgeMs: number | null): void {
    this.queueDepth = depth;
    this.oldestQueuedAt = oldestAgeMs !== null ? Date.now() - oldestAgeMs : null;
  }

  recordDroppedDuplicate(): void {
    this.droppedDuplicates++;
  }

  recordRejectedOverflow(): void {
    this.rejectedOverflow++;
  }

  recordLatency(ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > this.config.latencyWindowSamples) {
      this.latencies.shift();
    }
  }

  setCurrentChainSlot(slot: number): void {
    this.currentChainSlot = slot;
  }

  evaluate(): ProviderState {
    const now = Date.now();
    this.pruneOldErrors(now);

    const slotLag = this.lastEventSlot !== null
      ? this.currentChainSlot - this.lastEventSlot
      : null;

    // Check conditions for opening circuit
    if (slotLag !== null && slotLag > this.config.maxSlotLag) {
      this.transitionTo('open');
      return this.state;
    }

    if (this.errorTimestamps.length >= this.config.maxErrorsPerMinute) {
      this.transitionTo('open');
      return this.state;
    }

    if (this.lastEventTime) {
      const elapsed = (now - new Date(this.lastEventTime).getTime()) / 1000;
      if (elapsed > this.config.heartbeatTimeoutSeconds) {
        this.transitionTo('degraded');
        return this.state;
      }
    }

    if (this.oldestQueuedAt !== null) {
      const ageSeconds = (now - this.oldestQueuedAt) / 1000;
      if (ageSeconds > this.config.maxQueuedCandidateAgeSeconds) {
        this.transitionTo('open');
        return this.state;
      }
    }

    if (this.queueDepth > this.config.maxCandidateQueueDepth) {
      this.transitionTo('degraded');
      return this.state;
    }

    if (this.state === 'degraded') {
      this.state = 'healthy';
    }

    return this.state;
  }

  getSnapshot(providerName: string): ProviderHealthSnapshot {
    const percentile = (pct: number) => {
      if (this.latencies.length === 0) return 0;
      const sorted = [...this.latencies].sort((a, b) => a - b);
      return sorted[Math.floor(sorted.length * pct / 100)] ?? 0;
    };

    return {
      providerName,
      state: this.state,
      lastEventSlot: this.lastEventSlot,
      lastEventTime: this.lastEventTime,
      currentChainSlot: this.currentChainSlot,
      slotLag: this.lastEventSlot !== null ? this.currentChainSlot - this.lastEventSlot : null,
      reconnectCount: this.reconnectCount,
      errorsInWindow: this.errorTimestamps.length,
      queueDepth: this.queueDepth,
      oldestQueuedAgeMs: this.oldestQueuedAt !== null ? Date.now() - this.oldestQueuedAt : null,
      droppedDuplicates: this.droppedDuplicates,
      rejectedOverflow: this.rejectedOverflow,
      processingLatencyMs: this.latencies.length > 0 ? this.latencies[this.latencies.length - 1] : null,
      p50LatencyMs: percentile(50),
      p95LatencyMs: percentile(95),
      p99LatencyMs: percentile(99),
      snapshotAt: new Date().toISOString(),
    };
  }

  getState(): ProviderState {
    return this.state;
  }

  private transitionTo(newState: ProviderState): void {
    if (this.state === newState) return;
    if (newState === 'open') {
      this.state = 'open';
      this.recoveryProbes = 0;
    } else if (newState === 'degraded' && this.state === 'open') {
      this.state = 'recovering';
      this.recoveryProbes = 0;
    } else {
      this.state = newState;
    }
  }

  private pruneOldErrors(now: number): void {
    const windowMs = 60_000;
    while (this.errorTimestamps.length > 0 && now - this.errorTimestamps[0] > windowMs) {
      this.errorTimestamps.shift();
    }
  }
}