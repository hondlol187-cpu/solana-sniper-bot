import {
  createHash,
} from 'node:crypto';

import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';

import { join } from 'node:path';

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

export interface ApprovedExecutionPlanState {
  status: 'prepared' | 'simulated' | 'cancelled';
  simulationCount: number;
  createdAt: string;
  simulatedAt?: string;
  lastSimulationResult?: string;
  cancellationReason?: string;
}

export interface ApprovedExecutionPlanFile {
  version: 1;
  planId: string;
  state: ApprovedExecutionPlanState;
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

function hashPlanContent(
  input: {
    version: 1;
    planId: string;
    state: ApprovedExecutionPlanState;
    payload: ApprovedExecutionPlanPayload;
  }
): string {
  return createHash('sha256')
    .update(stableStringify(input))
    .digest('hex');
}

function buildPlanId(
  payload: ApprovedExecutionPlanPayload
): string {
  const shortHash =
    createHash('sha256')
      .update(
        [
          payload.signature,
          payload.exactMint,
          payload.createdAt,
          payload.walletPublicKey,
        ].join('|')
      )
      .digest('hex')
      .slice(0, 16);

  return [
    payload.signature.slice(0, 12),
    payload.exactMint.slice(0, 12),
    shortHash,
  ].join('_');
}

export function getApprovedExecutionPlanPath(
  planId: string
): string {
  return join(
    config.approvedExecutionPlanDir,
    `${planId}.json`
  );
}

async function ensurePlanDirectory(): Promise<void> {
  await mkdir(
    config.approvedExecutionPlanDir,
    {
      recursive: true,
      mode: 0o700,
    }
  );
}

async function saveApprovedExecutionPlanFile(
  file: Omit<ApprovedExecutionPlanFile, 'sha256'>
): Promise<ApprovedExecutionPlanFile> {
  await ensurePlanDirectory();

  const complete: ApprovedExecutionPlanFile = {
    ...file,
    sha256: hashPlanContent(file),
  };

  const path =
    getApprovedExecutionPlanPath(
      complete.planId
    );

  const temporaryFile =
    `${path}.tmp`;

  await writeFile(
    temporaryFile,
    JSON.stringify(complete, null, 2),
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );

  await rename(
    temporaryFile,
    path
  );

  return complete;
}

export async function writeApprovedExecutionPlan(
  payload: ApprovedExecutionPlanPayload
): Promise<ApprovedExecutionPlanFile> {
  const planId =
    buildPlanId(payload);

  return saveApprovedExecutionPlanFile({
    version: 1,
    planId,
    state: {
      status: 'prepared',
      simulationCount: 0,
      createdAt: payload.createdAt,
    },
    payload,
  });
}

export async function loadApprovedExecutionPlan(
  planId: string
): Promise<ApprovedExecutionPlanFile> {
  const path =
    getApprovedExecutionPlanPath(planId);

  const content = await readFile(
    path,
    'utf8'
  );

  const parsed =
    JSON.parse(content) as Partial<ApprovedExecutionPlanFile>;

  if (
    parsed.version !== 1 ||
    typeof parsed.planId !== 'string' ||
    !parsed.state ||
    !parsed.payload ||
    typeof parsed.sha256 !== 'string'
  ) {
    throw new Error(
      'Approved execution plan has an unsupported format'
    );
  }

  const contentToHash = {
    version: parsed.version as 1,
    planId: parsed.planId,
    state: parsed.state as ApprovedExecutionPlanState,
    payload: parsed.payload as ApprovedExecutionPlanPayload,
  };

  const expectedHash =
    hashPlanContent(contentToHash);

  if (expectedHash !== parsed.sha256) {
    throw new Error(
      'Approved execution plan hash mismatch'
    );
  }

  if (parsed.planId !== planId) {
    throw new Error(
      'Approved execution plan ID mismatch'
    );
  }

  return parsed as ApprovedExecutionPlanFile;
}

export async function deleteApprovedExecutionPlan(
  planId: string
): Promise<void> {
  const path =
    getApprovedExecutionPlanPath(planId);

  await rm(path, {
    force: true,
  });
}

export async function markApprovedExecutionPlanSimulated(
  planId: string,
  result: string
): Promise<ApprovedExecutionPlanFile> {
  const file =
    await loadApprovedExecutionPlan(
      planId
    );

  if (file.state.status !== 'prepared') {
    throw new Error(
      `Approved execution plan is not reusable; current status is ${file.state.status}`
    );
  }

  return saveApprovedExecutionPlanFile({
    version: file.version,
    planId: file.planId,
    state: {
      ...file.state,
      status: 'simulated',
      simulationCount:
        file.state.simulationCount + 1,
      simulatedAt:
        new Date().toISOString(),
      lastSimulationResult: result,
    },
    payload: file.payload,
  });
}

export async function cancelApprovedExecutionPlan(
  planId: string,
  reason: string
): Promise<ApprovedExecutionPlanFile> {
  const file =
    await loadApprovedExecutionPlan(
      planId
    );

  const cleanReason =
    reason.trim();

  if (!cleanReason) {
    throw new Error(
      'Cancellation reason is required'
    );
  }

  return saveApprovedExecutionPlanFile({
    version: file.version,
    planId: file.planId,
    state: {
      ...file.state,
      status: 'cancelled',
      cancellationReason:
        cleanReason,
    },
    payload: file.payload,
  });
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
