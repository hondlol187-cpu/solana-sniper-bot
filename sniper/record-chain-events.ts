// sniper/record-chain-events.ts
export {};

import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface RecordedEvent {
  version: 1;
  type: string;
  data: Record<string, unknown>;
  slot: number;
  signature: string;
  timestamp: string;
}

export async function recordEvent(
  outputDir: string,
  event: RecordedEvent
): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const dateStr = new Date().toISOString().slice(0, 10);
  const filePath = join(outputDir, `events-${dateStr}.jsonl`);
  await appendFile(filePath, JSON.stringify(event) + '\n', 'utf8');
}