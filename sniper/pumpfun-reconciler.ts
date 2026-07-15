// sniper/pumpfun-reconciler.ts
import type { RawPumpfunEvent } from './pumpfun-event-source.js';

export interface ReconcilerState {
  lastProcessedSlot: number;
  reconnectCount: number;
  lastReconnectAt: string | null;
  gapsReconciled: number;
  duplicatesDeduped: number;
  totalProcessed: number;
}

export interface GapReport {
  startSlot: number;
  endSlot: number;
  reconciledEvents: number;
  reconciledAt: string;
}

const MAX_GAP_SLOTS = 10_000;
const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;

export class PumpfunReconciler {
  private state: ReconcilerState = {
    lastProcessedSlot: 0,
    reconnectCount: 0,
    lastReconnectAt: null,
    gapsReconciled: 0,
    duplicatesDeduped: 0,
    totalProcessed: 0,
  };

  private dedupKeys = new Set<string>();
  private gaps: GapReport[] = [];
  private consecutiveErrors = 0;

  updateSlot(slot: number): void {
    if (slot > this.state.lastProcessedSlot) {
      this.state.lastProcessedSlot = slot;
    }
  }

  deduplicate(
    event: RawPumpfunEvent
  ): { duplicate: boolean; key: string } {
    const key = `${event.signature}:${event.instructionIndex}`;

    if (this.dedupKeys.has(key)) {
      this.state.duplicatesDeduped++;
      return { duplicate: true, key };
    }

    this.dedupKeys.add(key);
    return { duplicate: false, key };
  }

  recordReconnect(): void {
    this.state.reconnectCount++;
    this.state.lastReconnectAt = new Date().toISOString();
    this.consecutiveErrors = 0;
  }

  getBackoffMs(): number {
    const backoff = Math.min(
      BASE_BACKOFF_MS * Math.pow(2, this.consecutiveErrors),
      MAX_BACKOFF_MS
    );
    // Add jitter: 0-25% random
    const jitter = backoff * Math.random() * 0.25;
    return Math.round(backoff + jitter);
  }

  recordError(): void {
    this.consecutiveErrors++;
  }

  /**
   * Calculate gap between expected and actual slot.
   * Returns null if no gap or gap is within tolerance.
   */
  detectGap(currentSlot: number): { startSlot: number; endSlot: number } | null {
    const expected = this.state.lastProcessedSlot + 1;

    if (currentSlot <= expected) {
      return null;
    }

    const gapSize = currentSlot - expected;

    if (gapSize > MAX_GAP_SLOTS) {
      throw new Error(
        `Unbounded gap detected: ${gapSize} slots. Refusing to reconcile.`
      );
    }

    return { startSlot: expected, endSlot: currentSlot - 1 };
  }

  recordGapReconciliation(
    startSlot: number,
    endSlot: number,
    eventCount: number
  ): void {
    const report: GapReport = {
      startSlot,
      endSlot,
      reconciledEvents: eventCount,
      reconciledAt: new Date().toISOString(),
    };

    this.gaps.push(report);
    this.state.gapsReconciled++;
    this.updateSlot(endSlot);
  }

  markProcessed(): void {
    this.state.totalProcessed++;
  }

  getState(): ReconcilerState {
    return { ...this.state };
  }

  getGaps(): GapReport[] {
    return [...this.gaps];
  }

  reset(): void {
    this.state = {
      lastProcessedSlot: 0,
      reconnectCount: 0,
      lastReconnectAt: null,
      gapsReconciled: 0,
      duplicatesDeduped: 0,
      totalProcessed: 0,
    };
    this.dedupKeys.clear();
    this.gaps = [];
    this.consecutiveErrors = 0;
  }
}