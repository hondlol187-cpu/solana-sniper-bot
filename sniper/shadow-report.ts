// sniper/shadow-report.ts
import type { ShadowProcessingResult } from './shadow-runner.js';
import { mkdir, appendFile, readFile, readdir, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface ShadowCandidateReport {
  version: 1;
  source: 'raydium' | 'pumpfun';
  sourceEventId: string;
  mint: string;
  creator?: string;
  pool?: string;
  detectionSlot?: number;
  detectionTime: string;
  decodeLatencyMs: number;
  validationLatencyMs: number;
  riskSafe?: boolean;
  riskScore?: number;
  riskReasons: string[];
  sellable?: boolean;
  sellabilityReasons: string[];
  routeResult?: string;
  proposedAmount?: string;
  finalDecision: 'accepted' | 'rejected';
  rejectionReasons: string[];
  processingLatencyMs: number;
  recordedAt: string;
}

const SECRET_FIELD_NAMES = new Set([
  'privatekey', 'private_key', 'secret', 'seed',
  'authorization', 'apikey', 'api_key', 'token',
  'password', 'auth_header',
]);

function sanitizeReport(
  result: ShadowProcessingResult
): ShadowCandidateReport {
  const report: ShadowCandidateReport = {
    version: 1,
    source: result.source,
    sourceEventId: result.sourceEventId,
    mint: result.mint,
    creator: result.creator,
    pool: result.pool,
    detectionSlot: result.detectionSlot,
    detectionTime: result.detectionTime,
    decodeLatencyMs: result.decodeLatencyMs,
    validationLatencyMs: result.validationLatencyMs,
    riskSafe: result.riskResult?.safe,
    riskScore: result.riskResult?.score,
    riskReasons: result.riskResult?.reasons ?? [],
    sellable: result.sellabilityResult?.sellable,
    sellabilityReasons: result.sellabilityResult?.reasons ?? [],
    routeResult: result.routeResult,
    proposedAmount: result.proposedAmount,
    finalDecision: result.finalDecision,
    rejectionReasons: result.rejectionReasons,
    processingLatencyMs: result.processingLatencyMs,
    recordedAt: new Date().toISOString(),
  };

  // Verify no secret fields leaked — check keys on input and output
  const allKeys = new Set<string>();
  for (const key of Object.keys(result) as string[]) {
    allKeys.add(key.toLowerCase());
  }
  for (const key of Object.keys(report)) {
    allKeys.add(key.toLowerCase());
  }
  for (const key of allKeys) {
    if (SECRET_FIELD_NAMES.has(key)) {
      throw new Error(`Report contains potential secret field: ${key}`);
    }
  }

  return report;
}

export async function recordShadowReport(
  reportDirectory: string,
  result: ShadowProcessingResult
): Promise<void> {
  await mkdir(reportDirectory, { recursive: true });

  const report = sanitizeReport(result);
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `shadow-${dateStr}-${result.sourceEventId.slice(0, 8)}.jsonl`;
  const filePath = join(reportDirectory, filename);

  await appendFile(
    filePath,
    JSON.stringify(report) + '\n',
    'utf8'
  );
}

export async function readShadowReports(
  reportDirectory: string,
  date?: string
): Promise<ShadowCandidateReport[]> {
  const reports: ShadowCandidateReport[] = [];

  try {
    const files = await readdir(reportDirectory);

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      if (date && !file.includes(date)) continue;

      const filePath = join(reportDirectory, file);
      const content = await readFile(filePath, 'utf8');

      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as ShadowCandidateReport;
          if (parsed.version === 1) {
            reports.push(parsed);
          }
        } catch {
          // Skip malformed lines
        }
      }
    }
  } catch {
    // Directory may not exist yet
  }

  return reports;
}

export async function pruneOldReports(
  reportDirectory: string,
  retentionDays: number
): Promise<number> {
  let pruned = 0;
  const cutoff = Date.now() - (retentionDays * 86400_000);

  try {
    const files = await readdir(reportDirectory);

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;

      const filePath = join(reportDirectory, file);

      try {
        const fileStat = await stat(filePath);
        if (fileStat.mtimeMs < cutoff) {
          await unlink(filePath);
          pruned++;
        }
      } catch {
        // Skip files we can't stat
      }
    }
  } catch {
    // Directory may not exist
  }

  return pruned;
}