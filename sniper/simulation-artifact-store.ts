import {
  createHash,
  randomUUID,
} from 'node:crypto';

import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';

import {
  join,
} from 'node:path';

import {
  VersionedTransaction,
} from '@solana/web3.js';

import {
  config,
} from './config.js';

import {
  withFileLock,
} from './file-lock.js';

import type {
  SimulationArtifactReturnData,
  SimulationReceipt,
} from './execution-plan.js';

export interface StoredSimulationArtifact {
  version: 1;
  artifactId: string;
  artifactSha256: string;

  planId: string;
  planInstanceId: string;
  planSha256BeforeSimulation: string;

  createdAt: string;

  serializedTransactionBase64:
    string;

  simulationResponse: {
    contextSlot: number;
    err: unknown | null;
    logs: string[];
    unitsConsumed?: number;
    returnData?:
      SimulationArtifactReturnData;
  };
}

export interface PersistSimulationArtifactInput {
  planId: string;
  planInstanceId: string;
  planSha256BeforeSimulation:
    string;

  serializedTransaction: Buffer;

  simulationResponse: {
    contextSlot: number;
    err: unknown | null;
    logs?: string[];
    unitsConsumed?: number;
    returnData?:
      SimulationArtifactReturnData;
  };

  createdAt: string;
}

function stableStringify(
  value: unknown
): string {
  if (value === undefined) {
    return 'null';
  }

  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value
      .map(stableStringify)
      .join(',')}]`;
  }

  const entries =
    Object.entries(
      value as Record<
        string,
        unknown
      >
    )
    .filter(
      ([, item]) =>
        item !== undefined
    )
    .sort(([left], [right]) =>
      left.localeCompare(right)
    );

  return `{${entries
    .map(
      ([key, item]) =>
        `${JSON.stringify(key)}:${stableStringify(item)}`
    )
    .join(',')}}`;
}

function sha256(
  value:
    string |
    Buffer |
    Uint8Array
): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

function assertSafeId(
  value: string,
  label: string
): void {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(
      value
    )
  ) {
    throw new Error(
      `${label} is invalid`
    );
  }
}

function getArtifactDirectory():
  string {
  return join(
    config
      .approvedExecutionPlanDir,
    'simulation-artifacts'
  );
}

export function getSimulationArtifactPath(
  artifactId: string
): string {
  assertSafeId(
    artifactId,
    'Simulation artifact ID'
  );

  return join(
    getArtifactDirectory(),
    `${artifactId}.json`
  );
}

function computeArtifactHash(
  artifact:
    Omit<
      StoredSimulationArtifact,
      'artifactSha256'
    >
): string {
  return sha256(
    stableStringify(
      artifact
    )
  );
}

function buildArtifactId(
  planInstanceId: string,
  serializedTransactionSha256:
    string
): string {
  return sha256(
    [
      'simulation-artifact-v1',
      planInstanceId,
      serializedTransactionSha256,
    ].join(':')
  ).slice(0, 32);
}

async function readExistingArtifact(
  path: string
): Promise<
  StoredSimulationArtifact |
  null
> {
  try {
    const stats =
      await lstat(path);

    if (
      stats.isSymbolicLink()
    ) {
      throw new Error(
        'Simulation artifact path is a symbolic link'
      );
    }

    if (!stats.isFile()) {
      throw new Error(
        'Simulation artifact path is not a file'
      );
    }

    const content =
      await readFile(
        path,
        'utf8'
      );

    return JSON.parse(
      content
    ) as StoredSimulationArtifact;
  } catch (error) {
    const code =
      (
        error as {
          code?: string;
        }
      ).code;

    if (code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

function validateArtifact(
  artifact:
    StoredSimulationArtifact
): void {
  if (
    artifact.version !== 1
  ) {
    throw new Error(
      `Unsupported simulation artifact version: ${String(
        artifact.version
      )}`
    );
  }

  assertSafeId(
    artifact.artifactId,
    'Simulation artifact ID'
  );

  assertSafeId(
    artifact.planId,
    'Simulation artifact plan ID'
  );

  if (
    !/^[0-9a-f]{64}$/.test(
      artifact
        .artifactSha256
    )
  ) {
    throw new Error(
      'Simulation artifact hash is invalid'
    );
  }

  if (
    !/^[0-9a-f]{64}$/.test(
      artifact
        .planSha256BeforeSimulation
    )
  ) {
    throw new Error(
      'Simulation artifact plan hash is invalid'
    );
  }

  const {
    artifactSha256,
    ...withoutHash
  } = artifact;

  const computed =
    computeArtifactHash(
      withoutHash
    );

  if (
    computed !==
    artifactSha256
  ) {
    throw new Error(
      'Simulation artifact hash mismatch'
    );
  }

  let serialized:
    Buffer;

  try {
    serialized =
      Buffer.from(
        artifact
          .serializedTransactionBase64,
        'base64'
      );
  } catch {
    throw new Error(
      'Simulation artifact transaction encoding is invalid'
    );
  }

  if (
    serialized.toString(
      'base64'
    ) !==
    artifact
      .serializedTransactionBase64
  ) {
    throw new Error(
      'Simulation artifact transaction encoding is not canonical'
    );
  }

  try {
    VersionedTransaction
      .deserialize(
        serialized
      );
  } catch {
    throw new Error(
      'Simulation artifact contains an invalid transaction'
    );
  }
}

export async function persistSimulationArtifact(
  input:
    PersistSimulationArtifactInput
): Promise<
  StoredSimulationArtifact
> {
  assertSafeId(
    input.planId,
    'Plan ID'
  );

  if (
    !input.planInstanceId
  ) {
    throw new Error(
      'Plan instance ID is required'
    );
  }

  const serializedTransactionSha256 =
    sha256(
      input
        .serializedTransaction
    );

  const artifactId =
    buildArtifactId(
      input.planInstanceId,
      serializedTransactionSha256
    );

  const withoutHash:
    Omit<
      StoredSimulationArtifact,
      'artifactSha256'
    > = {
      version: 1,
      artifactId,

      planId:
        input.planId,

      planInstanceId:
        input.planInstanceId,

      planSha256BeforeSimulation:
        input
          .planSha256BeforeSimulation,

      createdAt:
        input.createdAt,

      serializedTransactionBase64:
        input
          .serializedTransaction
          .toString('base64'),

      simulationResponse: {
        contextSlot:
          input
            .simulationResponse
            .contextSlot,

        err:
          input
            .simulationResponse
            .err,

        logs:
          input
            .simulationResponse
            .logs ??
          [],

        unitsConsumed:
          input
            .simulationResponse
            .unitsConsumed,

        returnData:
          input
            .simulationResponse
            .returnData,
      },
    };

  const artifact:
    StoredSimulationArtifact = {
      ...withoutHash,

      artifactSha256:
        computeArtifactHash(
          withoutHash
        ),
    };

  await mkdir(
    getArtifactDirectory(),
    {
      recursive: true,
      mode: 0o700,
    }
  );

  const path =
    getSimulationArtifactPath(
      artifactId
    );

  return withFileLock(
    path,
    async () => {
      const existing =
        await readExistingArtifact(
          path
        );

      if (existing) {
        validateArtifact(
          existing
        );

        if (
          existing
            .artifactSha256 !==
          artifact
            .artifactSha256
        ) {
          throw new Error(
            'Conflicting simulation artifact already exists'
          );
        }

        return existing;
      }

      const temporaryPath =
        `${path}.${randomUUID()}.tmp`;

      try {
        await writeFile(
          temporaryPath,
          JSON.stringify(
            artifact,
            null,
            2
          ),
          {
            encoding: 'utf8',
            mode: 0o600,
            flag: 'wx',
          }
        );

        await rename(
          temporaryPath,
          path
        );

        await chmod(
          path,
          0o600
        );
      } catch (error) {
        await rm(
          temporaryPath,
          {
            force: true,
          }
        );

        throw error;
      }

      return artifact;
    }
  );
}

export async function loadSimulationArtifact(
  artifactId: string
): Promise<
  StoredSimulationArtifact
> {
  const path =
    getSimulationArtifactPath(
      artifactId
    );

  const artifact =
    await readExistingArtifact(
      path
    );

  if (!artifact) {
    throw new Error(
      `Simulation artifact not found: ${artifactId}`
    );
  }

  validateArtifact(
    artifact
  );

  if (
    artifact.artifactId !==
    artifactId
  ) {
    throw new Error(
      'Simulation artifact ID does not match file name'
    );
  }

  return artifact;
}

export async function loadVerifiedArtifactBytes(
  receipt:
    SimulationReceipt,
  expectedPlanId: string,
  expectedPlanInstanceId:
    string
): Promise<Buffer> {
  if (
    !receipt.artifactId ||
    !receipt.artifactSha256
  ) {
    throw new Error(
      'Simulation receipt has no persisted artifact reference'
    );
  }

  const artifact =
    await loadSimulationArtifact(
      receipt.artifactId
    );

  if (
    artifact
      .artifactSha256 !==
    receipt.artifactSha256
  ) {
    throw new Error(
      'Persisted artifact does not match simulation receipt'
    );
  }

  if (
    artifact.planId !==
    expectedPlanId
  ) {
    throw new Error(
      'Persisted artifact belongs to a different plan'
    );
  }

  if (
    artifact
      .planInstanceId !==
    expectedPlanInstanceId
  ) {
    throw new Error(
      'Persisted artifact belongs to a different plan instance'
    );
  }

  if (
    artifact
      .planSha256BeforeSimulation !==
    receipt
      .planSha256BeforeSimulation
  ) {
    throw new Error(
      'Persisted artifact plan hash does not match receipt'
    );
  }

  const bytes =
    Buffer.from(
      artifact
        .serializedTransactionBase64,
      'base64'
    );

  if (
    sha256(bytes) !==
    receipt
      .serializedTransactionSha256
  ) {
    throw new Error(
      'Persisted transaction bytes do not match receipt'
    );
  }

  return bytes;
}
