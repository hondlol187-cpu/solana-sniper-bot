// sniper/jito-bundle-journal.ts
import type { BundleState } from './jito-reconciler.js';
import { appendFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface BundleJournalEntry {
  version: 1;
  planId: string;
  artifactId: string;
  attemptId: string;
  bundleId?: string;
  txSignature?: string;
  txMessageHash?: string;
  bundleHash?: string;
  tipAmount: number;
  tipAccount?: string;
  endpoint?: string;
  submissionState: BundleState;
  createdAt: string;
  updatedAt: string;
  reconcileAttempts: number;
  error?: string;
}

export interface JournalSummary {
  totalEntries: number;
  byState: Record<BundleState, number>;
  ambiguousCount: number;
  fallbackRecommendedCount: number;
}

export class JitoBundleJournal {
  private journalDir: string;
  private entries = new Map<string, BundleJournalEntry>();

  constructor(journalDir: string) {
    this.journalDir = journalDir;
  }

  async init(): Promise<void> {
    await mkdir(this.journalDir, { recursive: true });
  }

  async record(entry: Omit<BundleJournalEntry, 'version' | 'createdAt' | 'updatedAt' | 'reconcileAttempts'>): Promise<BundleJournalEntry> {
    const now = new Date().toISOString();
    const fullEntry: BundleJournalEntry = {
      version: 1,
      ...entry,
      createdAt: entry.submissionState === 'prepared' ? now : (this.entries.get(entry.attemptId)?.createdAt ?? now),
      updatedAt: now,
      reconcileAttempts: this.entries.get(entry.attemptId)?.reconcileAttempts ?? 0,
    };

    this.entries.set(entry.attemptId, fullEntry);

    await this.appendEntry(fullEntry);

    return fullEntry;
  }

  async updateState(
    attemptId: string,
    newState: BundleState,
    extra?: Partial<Pick<BundleJournalEntry, 'bundleId' | 'txSignature' | 'error'>>
  ): Promise<BundleJournalEntry | null> {
    const existing = this.entries.get(attemptId);
    if (!existing) return null;

    const updated: BundleJournalEntry = {
      ...existing,
      submissionState: newState,
      updatedAt: new Date().toISOString(),
      ...extra,
    };

    this.entries.set(attemptId, updated);
    await this.appendEntry(updated);

    return updated;
  }

  get(attemptId: string): BundleJournalEntry | undefined {
    return this.entries.get(attemptId);
  }

  getByBundleId(bundleId: string): BundleJournalEntry | undefined {
    for (const entry of this.entries.values()) {
      if (entry.bundleId === bundleId) return entry;
    }
    return undefined;
  }

  getAmbiguous(): BundleJournalEntry[] {
    return Array.from(this.entries.values()).filter(
      e => e.submissionState === 'ambiguous' || e.submissionState === 'submitted'
    );
  }

  getSummary(): JournalSummary {
    const byState: Record<BundleState, number> = {
      prepared: 0, submitted: 0, accepted: 0, landed: 0,
      rejected: 0, expired: 0, ambiguous: 0, reconciled: 0,
    };

    for (const entry of this.entries.values()) {
      byState[entry.submissionState]++;
    }

    return {
      totalEntries: this.entries.size,
      byState,
      ambiguousCount: byState.ambiguous + byState.submitted,
      fallbackRecommendedCount: 0,
    };
  }

  private async appendEntry(entry: BundleJournalEntry): Promise<void> {
    const filePath = join(this.journalDir, 'jito-bundle-journal.jsonl');
    await appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
  }
}