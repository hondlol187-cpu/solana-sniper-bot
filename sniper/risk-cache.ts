// sniper/risk-cache.ts
import type { RiskEvidence, RiskDecision } from './risk-evidence.js';

export interface CachedRiskEntry {
  mintAddress: string;
  decision: RiskDecision;
  evidence: RiskEvidence;
  cachedAt: string;
  ttlSeconds: number;
  hits: number;
}

const DEFAULT_TTL_SECONDS = 30;
const MAX_CACHE_ENTRIES = 5000;

export class RiskCache {
  private cache = new Map<string, CachedRiskEntry>();
  private maxEntries: number;
  private defaultTtlSeconds: number;

  constructor(maxEntries = MAX_CACHE_ENTRIES, defaultTtlSeconds = DEFAULT_TTL_SECONDS) {
    this.maxEntries = maxEntries;
    this.defaultTtlSeconds = defaultTtlSeconds;
  }

  get(mintAddress: string): CachedRiskEntry | null {
    const entry = this.cache.get(mintAddress);

    if (!entry) return null;

    const ageSeconds = (Date.now() - new Date(entry.cachedAt).getTime()) / 1000;

    if (ageSeconds > entry.ttlSeconds) {
      this.cache.delete(mintAddress);
      return null;
    }

    entry.hits++;
    return entry;
  }

  set(
    mintAddress: string,
    decision: RiskDecision,
    evidence: RiskEvidence,
    ttlSeconds?: number
  ): void {
    this.evictIfNeeded();

    this.cache.set(mintAddress, {
      mintAddress,
      decision,
      evidence,
      cachedAt: new Date().toISOString(),
      ttlSeconds: ttlSeconds ?? this.defaultTtlSeconds,
      hits: 0,
    });
  }

  invalidate(mintAddress: string): boolean {
    return this.cache.delete(mintAddress);
  }

  invalidateIfHashChanged(
    mintAddress: string,
    expectedHash: string
  ): boolean {
    const entry = this.cache.get(mintAddress);

    if (!entry) return false;

    if (entry.evidence.reportHash !== expectedHash) {
      this.cache.delete(mintAddress);
      return true;
    }

    return false;
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  getStats(): { entries: number; totalHits: number } {
    let totalHits = 0;

    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }

    return {
      entries: this.cache.size,
      totalHits,
    };
  }

  private evictIfNeeded(): void {
    if (this.cache.size < this.maxEntries) return;

    // Evict oldest entries (first inserted)
    const keys = Array.from(this.cache.keys());
    const evictCount = Math.ceil(keys.length * 0.1);

    for (let i = 0; i < evictCount; i++) {
      this.cache.delete(keys[i]);
    }
  }
}