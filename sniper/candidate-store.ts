import {
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';

import { config } from './config.js';
import { audit } from './audit.js';

import {
  ValidatedRaydiumPool,
} from './pool-validator.js';

import {
  withFileLock,
} from './file-lock.js';

export type CandidateStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed';

export type CandidateSource =
  | 'raydium'
  | 'pumpfun';

export type CandidateLifecycleStage =
  | 'pending'
  | 'pumpfun_detected'
  | 'migration_detected'
  | 'raydium_pool_validated'
  | 'approved'
  | 'rejected'
  | 'executed';

export interface CandidateRecord {
  signature: string;
  poolAddress: string;
  baseMint: string;

  status: CandidateStatus;
  source: CandidateSource;
  lifecycleStage?: CandidateLifecycleStage;

  pool: ValidatedRaydiumPool;

  firstSeenAt: string;
  updatedAt: string;

  approval?: {
    approvedAt: string;
    confirmedMint: string;

    approvedPoolAddress: string;
    approvedQuoteMint: string;
    approvedLiquiditySol: number;
  };

  rejection?: {
    rejectedAt: string;
    reason: string;
  };

  execution?: {
    completedAt: string;
    mode: 'live';
    result: string;
  };
}

interface CandidateStore {
  version: 1;
  candidates: CandidateRecord[];
}

const emptyStore = (): CandidateStore => ({
  version: 1,
  candidates: [],
});

/*
 * Serialize modifications inside this process so
 * concurrent pool validations cannot overwrite one
 * another.
 */
let modificationQueue:
  Promise<void> = Promise.resolve();

function serialize<T>(
  operation: () => Promise<T>
): Promise<T> {
  const guardedOperation = () =>
    withFileLock(
      config.candidateStoreFile,
      operation
    );

  const run =
    modificationQueue.then(
      guardedOperation,
      guardedOperation
    );

  modificationQueue = run.then(
    () => undefined,
    () => undefined
  );

  return run;
}

function validateStore(
  value: unknown
): CandidateStore {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    throw new Error(
      'Candidate store is not an object'
    );
  }

  const candidate =
    value as Partial<CandidateStore>;

  if (
    candidate.version !== 1 ||
    !Array.isArray(
      candidate.candidates
    )
  ) {
    throw new Error(
      'Candidate store has an unsupported format'
    );
  }

  for (
    const record of
    candidate.candidates
  ) {
    if (
      !record ||
      typeof record !== 'object'
    ) {
      throw new Error(
        'Candidate store contains an invalid record'
      );
    }

    const item =
      record as Partial<CandidateRecord>;

    if (
      typeof item.signature !==
        'string' ||
      typeof item.poolAddress !==
        'string' ||
      typeof item.baseMint !==
        'string' ||
      ![
        'pending',
        'approved',
        'rejected',
        'executed',
      ].includes(
        String(item.status)
      )
    ) {
      throw new Error(
        'Candidate store contains a malformed record'
      );
    }

    /*
     * Default source/lifecycleStage for
     * records created before these fields
     * existed.
     */
    if (!item.source) {
      item.source = 'raydium';
    }
  }

  return candidate as CandidateStore;
}

async function loadStoreUnsafe(): Promise<CandidateStore> {
  try {
    const content = await readFile(
      config.candidateStoreFile,
      'utf8'
    );

    return validateStore(
      JSON.parse(content)
    );
  } catch (error) {
    const code = (
      error as NodeJS.ErrnoException
    ).code;

    if (code === 'ENOENT') {
      return emptyStore();
    }

    throw error;
  }
}

async function saveStoreUnsafe(
  store: CandidateStore
): Promise<void> {
  const temporaryFile =
    `${config.candidateStoreFile}.tmp`;

  await writeFile(
    temporaryFile,
    JSON.stringify(store, null, 2),
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );

  await rename(
    temporaryFile,
    config.candidateStoreFile
  );
}

function trimStore(
  store: CandidateStore
): void {
  if (
    store.candidates.length <=
    config.maximumCandidateRecords
  ) {
    return;
  }

  /*
   * Retain approved candidates first, then retain
   * the newest remaining candidates.
   */
  store.candidates.sort(
    (left, right) => {
      if (
        left.status === 'approved' &&
        right.status !== 'approved'
      ) {
        return -1;
      }

      if (
        right.status === 'approved' &&
        left.status !== 'approved'
      ) {
        return 1;
      }

      return (
        new Date(
          right.updatedAt
        ).getTime() -
        new Date(
          left.updatedAt
        ).getTime()
      );
    }
  );

  store.candidates =
    store.candidates.slice(
      0,
      config.maximumCandidateRecords
    );
}

export async function hasCandidate(
  signature: string
): Promise<boolean> {
  return serialize(async () => {
    const store =
      await loadStoreUnsafe();

    return store.candidates.some(
      (candidate) =>
        candidate.signature ===
        signature
    );
  });
}

export interface QueueValidatedPoolOptions {
  source?: CandidateSource;
  lifecycleStage?: CandidateLifecycleStage;
}

export async function queueValidatedPool(
  pool: ValidatedRaydiumPool,
  options?: QueueValidatedPoolOptions
): Promise<CandidateRecord> {
  return serialize(async () => {
    const store =
      await loadStoreUnsafe();

    const existing =
      store.candidates.find(
        (candidate) =>
          candidate.signature ===
            pool.signature ||
          candidate.poolAddress ===
            pool.poolAddress
      );

    if (existing) {
      return existing;
    }

    const now =
      new Date().toISOString();

    const record: CandidateRecord = {
      signature: pool.signature,
      poolAddress:
        pool.poolAddress,
      baseMint:
        pool.baseMint,

      status: 'pending',
      source: options?.source ?? 'raydium',
      lifecycleStage:
        options?.lifecycleStage ?? 'pending',

      pool,

      firstSeenAt: now,
      updatedAt: now,
    };

    store.candidates.push(record);

    trimStore(store);
    await saveStoreUnsafe(store);

    await audit(
      'candidate.queued',
      {
        signature:
          record.signature,
        poolAddress:
          record.poolAddress,
        baseMint:
          record.baseMint,
        liquiditySol:
          pool.liquiditySol,
        source: record.source,
        lifecycleStage:
          record.lifecycleStage,
      }
    );

    return record;
  });
}

export async function approveCandidate(
  signature: string,
  confirmedMint: string
): Promise<CandidateRecord> {
  return serialize(async () => {
    const store =
      await loadStoreUnsafe();

    const candidate =
      store.candidates.find(
        (item) =>
          item.signature === signature
      );

    if (!candidate) {
      throw new Error(
        'Candidate was not found'
      );
    }

    if (
      candidate.baseMint !==
      confirmedMint
    ) {
      throw new Error(
        [
          'Mint confirmation does not match.',
          `Expected: ${candidate.baseMint}.`,
          `Received: ${confirmedMint}.`,
        ].join(' ')
      );
    }

    if (
      candidate.status === 'rejected' ||
      candidate.status === 'executed'
    ) {
      throw new Error(
        `${candidate.status} candidate cannot be approved`
      );
    }

    const now =
      new Date().toISOString();

    candidate.status = 'approved';
    candidate.updatedAt = now;
    candidate.approval = {
      approvedAt: now,
      confirmedMint,

      approvedPoolAddress:
        candidate.poolAddress,

      approvedQuoteMint:
        candidate.pool.quoteMint,

      approvedLiquiditySol:
        candidate.pool.liquiditySol,
    };

    await saveStoreUnsafe(store);

    await audit(
      'candidate.approved',
      {
        signature,
        poolAddress:
          candidate.poolAddress,
        confirmedMint,
      }
    );

    return candidate;
  });
}

export async function rejectCandidate(
  signature: string,
  reason: string
): Promise<CandidateRecord> {
  return serialize(async () => {
    const store =
      await loadStoreUnsafe();

    const candidate =
      store.candidates.find(
        (item) =>
          item.signature === signature
      );

    if (!candidate) {
      throw new Error(
        'Candidate was not found'
      );
    }

    if (
      candidate.status === 'approved'
    ) {
      throw new Error(
        'Approved candidate cannot be rejected'
      );
    }

    const cleanReason =
      reason.trim();

    if (!cleanReason) {
      throw new Error(
        'Rejection reason is required'
      );
    }

    const now =
      new Date().toISOString();

    candidate.status = 'rejected';
    candidate.updatedAt = now;
    candidate.rejection = {
      rejectedAt: now,
      reason: cleanReason,
    };

    await saveStoreUnsafe(store);

    await audit(
      'candidate.rejected',
      {
        signature,
        poolAddress:
          candidate.poolAddress,
        reason: cleanReason,
      }
    );

    return candidate;
  });
}

export async function listCandidates(
  status?: CandidateStatus
): Promise<CandidateRecord[]> {
  return serialize(async () => {
    const store =
      await loadStoreUnsafe();

    return store.candidates
      .filter(
        (candidate) =>
          !status ||
          candidate.status === status
      )
      .sort(
        (left, right) =>
          new Date(
            right.updatedAt
          ).getTime() -
          new Date(
            left.updatedAt
          ).getTime()
      );
  });
}

export async function getCandidate(
  signature: string
): Promise<CandidateRecord | null> {
  return serialize(async () => {
    const store =
      await loadStoreUnsafe();

    return (
      store.candidates.find(
        (candidate) =>
          candidate.signature ===
          signature
      ) ?? null
    );
  });
}

export async function markCandidateExecuted(
  signature: string,
  result: string
): Promise<CandidateRecord> {
  return serialize(async () => {
    const store =
      await loadStoreUnsafe();

    const candidate =
      store.candidates.find(
        (item) =>
          item.signature === signature
      );

    if (!candidate) {
      throw new Error(
        'Candidate was not found'
      );
    }

    if (
      candidate.status !== 'approved'
    ) {
      throw new Error(
        `Only approved candidates can be marked executed; current status is ${candidate.status}`
      );
    }

    const now =
      new Date().toISOString();

    candidate.status = 'executed';
    candidate.updatedAt = now;
    candidate.execution = {
      completedAt: now,
      mode: 'live',
      result,
    };

    await saveStoreUnsafe(store);

    await audit(
      'candidate.executed',
      {
        signature,
        poolAddress:
          candidate.poolAddress,
        baseMint:
          candidate.baseMint,
        result,
      }
    );

    return candidate;
  });
}

export async function clearCandidateStore(): Promise<void> {
  return serialize(async () => {
    try {
      await unlink(
        config.candidateStoreFile
      );
    } catch (error) {
      const code = (
        error as NodeJS.ErrnoException
      ).code;

      if (code !== 'ENOENT') {
        throw error;
      }
    }
  });
}
