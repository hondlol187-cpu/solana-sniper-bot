import {
  createHash,
} from 'node:crypto';

import {
  rename,
  writeFile,
  readFile,
} from 'node:fs/promises';

import { config } from './config.js';

export interface ApprovedExecutionPlanPayload {
  signature: string;
  exactMint: string;
  createdAt: string;
  quoteReceivedAtMs: number;

  walletPublicKey: string;
  expectedCluster: string;
  buyLamports: string;

  approvedPoolAddress: string;
  approvedQuoteMint: string;
  approvedLiquiditySol: number;

  currentPoolAddress: string;
  currentQuoteMint: string;
  currentLiquiditySol: number;

  routeHopCount: number;
  routeLabels: string[];
  routeAmmKeys: string[];

  quoteInputMint: string;
  quoteOutputMint: string;
  quoteInAmount: string;
  quoteOutAmount: string;
  quoteOtherAmountThreshold: string;
  quoteSlippageBps: number;
  quotePriceImpactPct: string;
  quoteRoutePlan: unknown[];

  routeOk: boolean;
  routeReasons: string[];

  approvalOk: boolean;
  approvalReasons: string[];
  quoteAgeMs: number;
  liquidityDropPct: number | null;
}

export interface ApprovedExecutionPlanFile {
  version: 1;
  payload: ApprovedExecutionPlanPayload;
  sha256: string;
}

function stableStringify(
  value: unknown
): string {
  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(
    value as Record<string, unknown>
  ).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return `{${entries
    .map(
      ([key, item]) =>
        `${JSON.stringify(key)}:${stableStringify(item)}`
    )
    .join(',')}}`;
}

function hashPayload(
  payload: ApprovedExecutionPlanPayload
): string {
  return createHash('sha256')
    .update(stableStringify(payload))
    .digest('hex');
}

export async function writeApprovedExecutionPlan(
  payload: ApprovedExecutionPlanPayload
): Promise<ApprovedExecutionPlanFile> {
  const file: ApprovedExecutionPlanFile = {
    version: 1,
    payload,
    sha256: hashPayload(payload),
  };

  const temporaryFile =
    `${config.approvedExecutionPlanFile}.tmp`;

  await writeFile(
    temporaryFile,
    JSON.stringify(file, null, 2),
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );

  await rename(
    temporaryFile,
    config.approvedExecutionPlanFile
  );

  return file;
}

export async function loadApprovedExecutionPlan(): Promise<ApprovedExecutionPlanFile> {
  const content = await readFile(
    config.approvedExecutionPlanFile,
    'utf8'
  );

  const parsed =
    JSON.parse(content) as Partial<ApprovedExecutionPlanFile>;

  if (
    parsed.version !== 1 ||
    !parsed.payload ||
    typeof parsed.sha256 !== 'string'
  ) {
    throw new Error(
      'Approved execution plan has an unsupported format'
    );
  }

  const expectedHash =
    hashPayload(
      parsed.payload as ApprovedExecutionPlanPayload
    );

  if (expectedHash !== parsed.sha256) {
    throw new Error(
      'Approved execution plan hash mismatch'
    );
  }

  return parsed as ApprovedExecutionPlanFile;
}

export function validateApprovedExecutionPlanAge(
  file: ApprovedExecutionPlanFile,
  nowMs: number = Date.now()
): void {
  const createdAtMs = Date.parse(
    file.payload.createdAt
  );

  if (!Number.isFinite(createdAtMs)) {
    throw new Error(
      'Approved execution plan createdAt is invalid'
    );
  }

  const ageMs =
    nowMs - createdAtMs;

  const maxAgeMs =
    config.maxApprovedExecutionPlanAgeSeconds *
    1_000;

  if (ageMs < 0) {
    throw new Error(
      'Approved execution plan time is in the future'
    );
  }

  if (ageMs > maxAgeMs) {
    throw new Error(
      [
        'Approved execution plan is too old.',
        `AgeMs: ${ageMs}.`,
        `MaxAgeMs: ${maxAgeMs}.`,
      ].join(' ')
    );
  }
}
