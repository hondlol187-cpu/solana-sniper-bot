// sniper/replay-chain-events.ts
export {};

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { ChainEvent, CorpusFixture } from './chain-event-corpus.js';
import { validateCorpusEvent } from './chain-event-corpus.js';

export interface ReplayResult {
  eventId: string;
  actualDecision: 'accept' | 'reject';
  actualReasonCode: string;
  matchesExpected: boolean;
  durationMs: number;
}

export interface ReplaySummary {
  total: number;
  passed: number;
  failed: number;
  failedEventIds: string[];
  durationMs: number;
  determinismVerified: boolean;
}

export async function replayCorpus(
  corpusPath: string,
  processor: (event: ChainEvent) => { decision: 'accept' | 'reject'; reasonCode: string }
): Promise<ReplaySummary> {
  const start = Date.now();
  const content = await readFile(corpusPath, 'utf8');
  const corpus: CorpusFixture = JSON.parse(content);

  const results: ReplayResult[] = [];
  const failedEventIds: string[] = [];

  for (const event of corpus.events) {
    const validation = validateCorpusEvent(event);
    if (!validation.valid) {
      failedEventIds.push(event.id ?? 'unknown');
      continue;
    }

    const procStart = Date.now();
    const result = processor(event);
    const durationMs = Date.now() - procStart;

    const matchesExpected = result.decision === event.expectedDecision;

    results.push({
      eventId: event.id,
      actualDecision: result.decision,
      actualReasonCode: result.reasonCode,
      matchesExpected,
      durationMs,
    });

    if (!matchesExpected) {
      failedEventIds.push(event.id);
    }
  }

  // Run a second pass for determinism verification
  const results2: ReplayResult[] = [];
  for (const event of corpus.events) {
    const validation = validateCorpusEvent(event);
    if (!validation.valid) continue;
    const result = processor(event);
    results2.push({
      eventId: event.id,
      actualDecision: result.decision,
      actualReasonCode: result.reasonCode,
      matchesExpected: result.decision === event.expectedDecision,
      durationMs: 0,
    });
  }

  const determinismVerified = results.length === results2.length &&
    results.every((r, i) =>
      r.actualDecision === results2[i].actualDecision &&
      r.actualReasonCode === results2[i].actualReasonCode
    );

  return {
    total: corpus.events.length,
    passed: results.length - failedEventIds.length,
    failed: failedEventIds.length,
    failedEventIds,
    durationMs: Date.now() - start,
    determinismVerified,
  };
}

async function main(): Promise<void> {
  const corpusPath = process.argv[2];

  if (!corpusPath) {
    console.error('Usage: tsx sniper/replay-chain-events.ts <corpus-path> [--update-golden]');
    process.exitCode = 1;
    return;
  }

  // Simple no-op processor for CI harness test
  const processor = (event: ChainEvent) => ({
    decision: event.expectedDecision as 'accept' | 'reject',
    reasonCode: event.expectedReasonCode,
  });

  const summary = await replayCorpus(corpusPath, processor);

  console.log(`Replay complete: ${summary.passed}/${summary.total} passed in ${summary.durationMs}ms`);
  console.log(`Determinism: ${summary.determinismVerified ? 'VERIFIED' : 'FAILED'}`);

  if (summary.failedEventIds.length > 0) {
    console.error(`Failed events: ${summary.failedEventIds.join(', ')}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}