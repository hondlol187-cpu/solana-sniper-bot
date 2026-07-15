export {};

import {
  createHash,
} from 'node:crypto';

import {
  readFile,
  lstat,
} from 'node:fs/promises';

import {
  execSync,
} from 'node:child_process';

function sha256(
  value:
    Buffer |
    string
): string {
  return createHash('sha256')
    .update(value)
    .digest('hex');
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

interface ReleaseManifest {
  version: 1;
  gitCommit: string;
  buildTimestamp: string;
  nodeVersion: string;
  npmVersion: string;
  lockfileSha256: string | null;
  sourceTreeSha256: string;
  testResult: {
    count: number;
    passed: number;
    failed: number;
  };
  releaseSurfaceOk: boolean;
  manifestSha256: string;
}

async function getFileHash(
  filePath: string
): Promise<
  string | null
> {
  try {
    const content =
      await readFile(
        filePath
      );

    return sha256(content);
  } catch {
    return null;
  }
}

async function listSourceFiles(
  directory: string,
  root: string
): Promise<string[]> {
  const { readdir } =
    await import(
      'node:fs/promises'
    );

  const { join, relative } =
    await import(
      'node:path'
    );

  const entries =
    await readdir(
      directory,
      {
        withFileTypes: true,
      }
    );

  const files: string[] =
    [];

  for (const entry of entries) {
    const fullPath =
      join(
        directory,
        entry.name
      );

    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === '.next'
      ) {
        continue;
      }

      files.push(
        ...await listSourceFiles(
          fullPath,
          root
        )
      );
    } else if (
      entry.isFile() &&
      (
        entry.name.endsWith('.ts') ||
        entry.name.endsWith('.js') ||
        entry.name.endsWith('.json') ||
        entry.name.endsWith('.mjs')
      )
    ) {
      files.push(
        relative(
          root,
          fullPath
        )
      );
    }
  }

  return files.sort();
}

async function computeSourceTreeHash(
  root: string
): Promise<string> {
  const files =
    await listSourceFiles(
      root,
      root
    );

  const hashes:
    string[] = [];

  for (const file of files) {
    const content =
      await readFile(
        `${root}/${file}`,
        'utf8'
      );

    hashes.push(
      `${file}:${sha256(content)}`
    );
  }

  return sha256(
    hashes.join('\n')
  );
}

async function main():
  Promise<void> {
  const [
    manifestPath,
  ] = process.argv.slice(2);

  if (!manifestPath) {
    throw new Error(
      'Usage: npm run release:verify -- <MANIFEST_FILE>'
    );
  }

  const errors:
    string[] = [];

  /*
   * Load the manifest.
   */
  const info =
    await lstat(
      manifestPath
    );

  if (
    info.isSymbolicLink()
  ) {
    throw new Error(
      'Manifest must not be a symbolic link'
    );
  }

  if (!info.isFile()) {
    throw new Error(
      'Manifest is not a regular file'
    );
  }

  let manifest:
    ReleaseManifest;

  try {
    manifest =
      JSON.parse(
        await readFile(
          manifestPath,
          'utf8'
        )
      ) as ReleaseManifest;
  } catch {
    throw new Error(
      'Manifest contains invalid JSON'
    );
  }

  if (
    manifest.version !== 1
  ) {
    throw new Error(
      `Unsupported manifest version: ${String(manifest.version)}`
    );
  }

  /*
   * Verify manifest hash.
   */
  const {
    manifestSha256,
    ...withoutHash
  } = manifest;

  const expectedHash =
    sha256(
      stableStringify(
        withoutHash
      )
    );

  if (
    manifestSha256 !==
    expectedHash
  ) {
    errors.push(
      'Manifest SHA-256 mismatch'
    );
  }

  /*
   * Verify git commit.
   */
  const currentCommit =
    execSync(
      'git rev-parse HEAD'
    )
      .toString()
      .trim();

  if (
    manifest.gitCommit !==
    currentCommit
  ) {
    errors.push(
      `Git commit mismatch: manifest=${manifest.gitCommit}, current=${currentCommit}`
    );
  }

  /*
   * Verify lockfile hash.
   */
  const currentLockfileHash =
    await getFileHash(
      'package-lock.json'
    );

  if (
    manifest.lockfileSha256 !==
    currentLockfileHash
  ) {
    errors.push(
      `Lockfile hash mismatch: manifest=${manifest.lockfileSha256}, current=${currentLockfileHash}`
    );
  }

  /*
   * Verify source tree hash.
   */
  const currentSourceHash =
    await computeSourceTreeHash(
      process.cwd()
    );

  if (
    manifest.sourceTreeSha256 !==
    currentSourceHash
  ) {
    errors.push(
      `Source tree hash mismatch: manifest=${manifest.sourceTreeSha256.slice(0, 16)}, current=${currentSourceHash.slice(0, 16)}`
    );
  }

  /*
   * Verify Node version.
   */
  if (
    manifest.nodeVersion !==
    process.version
  ) {
    errors.push(
      `Node version mismatch: manifest=${manifest.nodeVersion}, current=${process.version}`
    );
  }

  /*
   * Verify release surface.
   */
  if (
    !manifest.releaseSurfaceOk
  ) {
    errors.push(
      'Manifest was generated with release surface FAIL'
    );
  }

  /*
   * Verify test result.
   */
  if (
    manifest.testResult.failed >
    0
  ) {
    errors.push(
      `Manifest was generated with ${manifest.testResult.failed} failing tests`
    );
  }

  if (
    errors.length > 0
  ) {
    for (const error of errors) {
      console.error(
        `ERROR: ${error}`
      );
    }

    process.exitCode = 1;

    return;
  }

  console.log(
    [
      'RELEASE MANIFEST VERIFIED',
      `Commit: ${manifest.gitCommit.slice(0, 12)}`,
      `Tests: ${manifest.testResult.passed}/${manifest.testResult.count}`,
      `Manifest: ${manifest.manifestSha256.slice(0, 16)}...`,
    ].join(' | ')
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      `Release manifest verification failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 2;
  }
);
