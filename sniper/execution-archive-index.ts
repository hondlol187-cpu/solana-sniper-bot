import {
  createHash,
} from 'node:crypto';

import {
  appendFile,
  chmod,
  readFile,
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

import type {
  ExecutionArchive,
} from './execution-archive.js';

export interface ExecutionArchiveIndexEntry {
  sequence: number;

  previousHash:
    string |
    null;

  planId: string;
  planInstanceId: string;

  bundleSha256: string;
  archiveSha256: string;

  indexedAt: string;

  entryHash: string;
}

export interface ArchiveIndexVerification {
  ok: boolean;
  entryCount: number;
  errors: string[];

  entries:
    ExecutionArchiveIndexEntry[];
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

function hash(
  value: string
): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

function indexPath():
  string {
  return join(
    config
      .approvedExecutionPlanDir,
    'execution-archives',
    'index.jsonl'
  );
}

function lockPath():
  string {
  return `${indexPath()}.lock`;
}

function computeEntryHash(
  entry:
    Omit<
      ExecutionArchiveIndexEntry,
      'entryHash'
    >
): string {
  return hash(
    stableStringify(entry)
  );
}

function validateHash(
  value: string,
  label: string
): void {
  if (
    !/^[0-9a-f]{64}$/.test(
      value
    )
  ) {
    throw new Error(
      `${label} is invalid`
    );
  }
}

function validateEntry(
  entry:
    ExecutionArchiveIndexEntry
): void {
  if (
    !Number.isSafeInteger(
      entry.sequence
    ) ||
    entry.sequence < 1
  ) {
    throw new Error(
      'Archive index sequence is invalid'
    );
  }

  if (
    entry.previousHash !==
      null
  ) {
    validateHash(
      entry.previousHash,
      'Archive index previousHash'
    );
  }

  validateHash(
    entry.bundleSha256,
    'Archive index bundleSha256'
  );

  validateHash(
    entry.archiveSha256,
    'Archive index archiveSha256'
  );

  validateHash(
    entry.entryHash,
    'Archive index entryHash'
  );

  if (
    !Number.isFinite(
      Date.parse(
        entry.indexedAt
      )
    )
  ) {
    throw new Error(
      'Archive index indexedAt is invalid'
    );
  }

  const {
    entryHash,
    ...withoutHash
  } = entry;

  if (
    entryHash !==
    computeEntryHash(
      withoutHash
    )
  ) {
    throw new Error(
      'Archive index entry hash mismatch'
    );
  }
}

export async function readExecutionArchiveIndex():
  Promise<
    ExecutionArchiveIndexEntry[]
  > {
  let content: string;

  try {
    content =
      await readFile(
        indexPath(),
        'utf8'
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

  const entries:
    ExecutionArchiveIndexEntry[] =
    [];

  let lineNumber = 0;

  for (
    const line of
    content.split('\n')
  ) {
    lineNumber += 1;

    const trimmed =
      line.trim();

    if (!trimmed) {
      continue;
    }

    let entry:
      ExecutionArchiveIndexEntry;

    try {
      entry =
        JSON.parse(
          trimmed
        ) as
          ExecutionArchiveIndexEntry;
    } catch {
      throw new Error(
        `Archive index line ${lineNumber} contains invalid JSON`
      );
    }

    validateEntry(entry);

    entries.push(entry);
  }

  return entries;
}

export async function verifyExecutionArchiveIndex():
  Promise<
    ArchiveIndexVerification
  > {
  const errors: string[] =
    [];

  let entries:
    ExecutionArchiveIndexEntry[];

  try {
    entries =
      await readExecutionArchiveIndex();
  } catch (error) {
    return {
      ok: false,
      entryCount: 0,

      errors: [
        error instanceof Error
          ? error.message
          : String(error),
      ],

      entries: [],
    };
  }

  let expectedSequence = 1;

  let expectedPreviousHash:
    string |
    null = null;

  const planInstances =
    new Set<string>();

  for (
    let index = 0;
    index < entries.length;
    index += 1
  ) {
    const entry =
      entries[index];

    if (
      entry.sequence !==
      expectedSequence
    ) {
      errors.push(
        `Archive index sequence mismatch at entry ${index}: expected ${expectedSequence}, received ${entry.sequence}`
      );
    }

    if (
      entry.previousHash !==
      expectedPreviousHash
    ) {
      errors.push(
        `Archive index previousHash mismatch at sequence ${entry.sequence}`
      );
    }

    if (
      planInstances.has(
        entry.planInstanceId
      )
    ) {
      errors.push(
        `Archive index contains duplicate plan instance ${entry.planInstanceId}`
      );
    }

    planInstances.add(
      entry.planInstanceId
    );

    expectedSequence =
      entry.sequence +
      1;

    expectedPreviousHash =
      entry.entryHash;
  }

  return {
    ok:
      errors.length === 0,

    entryCount:
      entries.length,

    errors,
    entries,
  };
}

export async function indexExecutionArchive(
  archive:
    ExecutionArchive
): Promise<
  ExecutionArchiveIndexEntry
> {
  return withFileLock(
    lockPath(),
    async () => {
      const verification =
        await verifyExecutionArchiveIndex();

      if (!verification.ok) {
        throw new Error(
          `Archive index is invalid: ${verification.errors.join('; ')}`
        );
      }

      const existing =
        verification.entries
          .find(
            (entry) =>
              entry
                .planInstanceId ===
              archive.planInstanceId
          );

      if (existing) {
        if (
          existing.archiveSha256 !==
            archive.archiveSha256 ||
          existing.bundleSha256 !==
            archive
              .evidenceBundle
              .bundleSha256
        ) {
          throw new Error(
            'Conflicting archive index entry already exists'
          );
        }

        return existing;
      }

      const previous =
        verification.entries.at(
          -1
        );

      const withoutHash:
        Omit<
          ExecutionArchiveIndexEntry,
          'entryHash'
        > = {
          sequence:
            previous
              ? previous.sequence + 1
              : 1,

          previousHash:
            previous
              ?.entryHash ??
            null,

          planId:
            archive.planId,

          planInstanceId:
            archive
              .planInstanceId,

          bundleSha256:
            archive
              .evidenceBundle
              .bundleSha256,

          archiveSha256:
            archive
              .archiveSha256,

          indexedAt:
            new Date()
              .toISOString(),
        };

      const entry:
        ExecutionArchiveIndexEntry = {
          ...withoutHash,

          entryHash:
            computeEntryHash(
              withoutHash
            ),
        };

      validateEntry(entry);

      await appendFile(
        indexPath(),
        `${JSON.stringify(entry)}\n`,
        {
          encoding: 'utf8',
          mode: 0o600,
        }
      );

      await chmod(
        indexPath(),
        0o600
      );

      return entry;
    }
  );
}
