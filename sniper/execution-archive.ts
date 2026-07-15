import {
  createHash,
  randomUUID,
} from 'node:crypto';

import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';

import {
  join,
} from 'node:path';

import {
  config,
} from './config.js';

import {
  withFileLock,
} from './file-lock.js';

import {
  buildExecutionEvidenceBundle,
  verifyExecutionEvidenceBundle,
} from './execution-evidence.js';

import type {
  ExecutionEvidenceBundle,
} from './execution-evidence.js';

import type {
  FaultInjector,
} from './fault-injection.js';

import {
  noFaults,
} from './fault-injection.js';

export interface ExecutionArchive {
  version: 1;

  planId: string;
  planInstanceId: string;

  archivedAt: string;

  evidenceBundle:
    ExecutionEvidenceBundle;

  archiveSha256: string;
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

function computeArchiveHash(
  archive:
    Omit<
      ExecutionArchive,
      'archiveSha256'
    >
): string {
  return createHash('sha256')
    .update(
      stableStringify(
        archive
      )
    )
    .digest('hex');
}

function directory():
  string {
  return join(
    config
      .approvedExecutionPlanDir,
    'execution-archives'
  );
}

function pathFor(
  planInstanceId: string
): string {
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(
      planInstanceId
    )
  ) {
    throw new Error(
      'Plan instance ID is invalid'
    );
  }

  return join(
    directory(),
    `${planInstanceId}.json`
  );
}

export function verifyExecutionArchive(
  archive:
    ExecutionArchive
): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] =
    [];

  if (
    archive.version !== 1
  ) {
    errors.push(
      'Unsupported archive version'
    );
  }

  const {
    archiveSha256,
    ...withoutHash
  } = archive;

  const expectedHash =
    computeArchiveHash(
      withoutHash
    );

  if (
    archiveSha256 !==
    expectedHash
  ) {
    errors.push(
      'Archive SHA-256 mismatch'
    );
  }

  const evidenceResult =
    verifyExecutionEvidenceBundle(
      archive.evidenceBundle
    );

  errors.push(
    ...evidenceResult.errors
  );

  if (
    archive.planId !==
    archive.evidenceBundle
      .plan.planId
  ) {
    errors.push(
      'Archive plan ID mismatch'
    );
  }

  if (
    archive.planInstanceId !==
    archive.evidenceBundle
      .plan.planInstanceId
  ) {
    errors.push(
      'Archive plan-instance mismatch'
    );
  }

  return {
    ok:
      errors.length === 0,

    errors,
  };
}

export async function loadExecutionArchive(
  planInstanceId: string
): Promise<
  ExecutionArchive |
  null
> {
  const path =
    pathFor(
      planInstanceId
    );

  try {
    const info =
      await lstat(path);

    if (
      info.isSymbolicLink()
    ) {
      throw new Error(
        'Execution archive path is a symbolic link'
      );
    }

    if (!info.isFile()) {
      throw new Error(
        'Execution archive path is not a regular file'
      );
    }

    const archive =
      JSON.parse(
        await readFile(
          path,
          'utf8'
        )
      ) as ExecutionArchive;

    const verification =
      verifyExecutionArchive(
        archive
      );

    if (!verification.ok) {
      throw new Error(
        `Execution archive verification failed: ${verification.errors.join('; ')}`
      );
    }

    return archive;
  } catch (error) {
    if (
      (
        error as {
          code?: string;
        }
      ).code === 'ENOENT'
    ) {
      return null;
    }

    throw error;
  }
}

export async function archiveExecutionEvidence(
  planId: string,
  faultInjector: FaultInjector = noFaults
): Promise<
  ExecutionArchive
> {
  const evidenceBundle =
    await buildExecutionEvidenceBundle(
      planId
    );

  const evidenceVerification =
    verifyExecutionEvidenceBundle(
      evidenceBundle
    );

  if (!evidenceVerification.ok) {
    throw new Error(
      `Evidence bundle verification failed: ${evidenceVerification.errors.join('; ')}`
    );
  }

  const outcome =
    evidenceBundle
      .plan
      .state
      .executionOutcome;

  if (!outcome) {
    throw new Error(
      'Cannot archive plan without terminal execution outcome'
    );
  }

  if (
    evidenceBundle
      .settlements
      .some(
        (settlement) =>
          settlement.status !==
          'committed'
      )
  ) {
    throw new Error(
      'Cannot archive plan with incomplete settlements'
    );
  }

  const planInstanceId =
    evidenceBundle
      .plan
      .planInstanceId;

  await mkdir(
    directory(),
    {
      recursive: true,
      mode: 0o700,
    }
  );

  const path =
    pathFor(
      planInstanceId
    );

  return withFileLock(
    path,
    async () => {
      const existing =
        await loadExecutionArchive(
          planInstanceId
        );

      if (existing) {
        if (
          existing
            .evidenceBundle
            .bundleSha256 !==
          evidenceBundle
            .bundleSha256
        ) {
          throw new Error(
            'Conflicting execution archive already exists'
          );
        }

        const {
          indexExecutionArchive,
        } = await import(
          './execution-archive-index.js'
        );

        await indexExecutionArchive(
          existing
        );

        await faultInjector.checkpoint('archive-indexed');

        return existing;
      }

      const withoutHash:
        Omit<
          ExecutionArchive,
          'archiveSha256'
        > = {
          version: 1,

          planId:
            evidenceBundle
              .plan.planId,

          planInstanceId,

          archivedAt:
            new Date()
              .toISOString(),

          evidenceBundle,
      };

      const archive:
        ExecutionArchive = {
          ...withoutHash,

          archiveSha256:
            computeArchiveHash(
              withoutHash
            ),
        };

      const temporaryPath =
        `${path}.${randomUUID()}.tmp`;

      try {
        await writeFile(
          temporaryPath,
          JSON.stringify(
            archive,
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

      await faultInjector.checkpoint('archive-written');

      const {
        indexExecutionArchive,
      } = await import(
        './execution-archive-index.js'
      );

      await indexExecutionArchive(
        archive
      );

      await faultInjector.checkpoint('archive-indexed');

      return archive;
    }
  );
}

export async function listExecutionArchiveIds():
  Promise<string[]> {
  let entries: string[];

  try {
    entries =
      await readdir(
        directory()
      );
  } catch (error) {
    if (
      (
        error as {
          code?: string;
        }
      ).code === 'ENOENT'
    ) {
      return [];
    }

    throw error;
  }

  return entries
    .filter(
      (name) =>
        name.endsWith(
          '.json'
        ) &&
        name !==
          'index.json'
    )
    .map(
      (name) =>
        name.slice(
          0,
          -'.json'.length
        )
    )
    .sort();
}
