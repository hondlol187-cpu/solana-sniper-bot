export {};

import {
  createHash,
} from 'node:crypto';

import {
  readFile,
  readdir,
  writeFile,
  chmod,
  stat,
} from 'node:fs/promises';

import {
  join,
  relative,
} from 'node:path';

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

async function listSourceFiles(
  directory: string,
  root: string
): Promise<string[]> {
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
        join(root, file),
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

function getGitCommit():
  string {
  return execSync(
    'git rev-parse HEAD'
  )
    .toString()
    .trim();
}

function getNodeVersion():
  string {
  return process.version;
}

function getNpmVersion():
  string {
    return execSync(
      'npm --version'
    )
      .toString()
      .trim();
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

async function getTestCount():
  Promise<{
    count: number;
    passed: number;
    failed: number;
  }> {
  try {
    const output =
      execSync(
        'npx tsx --test tests/*.test.ts 2>&1 || true',
        {
          encoding: 'utf8',
          timeout: 180_000,
          maxBuffer: 10 * 1024 * 1024,
        }
      );

    const countMatch =
      output.match(
        /tests\s+(\d+)/
      );

    const passMatch =
      output.match(
        /pass\s+(\d+)/
      );

    const failMatch =
      output.match(
        /fail\s+(\d+)/
      );

    return {
      count: countMatch
        ? Number(countMatch[1])
        : 0,
      passed: passMatch
        ? Number(passMatch[1])
        : 0,
      failed: failMatch
        ? Number(failMatch[1])
        : 0,
    };
  } catch {
    return {
      count: 0,
      passed: 0,
      failed: 0,
    };
  }
}

async function getReleaseSurfaceResult():
  Promise<{
    ok: boolean;
    output: string;
  }> {
  try {
    const output =
      execSync(
        'npm run verify:release-surface 2>&1',
        {
          encoding: 'utf8',
          timeout: 30_000,
        }
      );

    return {
      ok: output.includes(
        'RELEASE SURFACE VERIFIED'
      ),
      output: output.trim(),
    };
  } catch (error) {
    return {
      ok: false,
      output: error instanceof Error
        ? error.message
        : String(error),
    };
  }
}

export interface ReleaseManifest {
  version: 1;

  gitCommit: string;
  buildTimestamp: string;

  nodeVersion: string;
  npmVersion: string;

  lockfileSha256:
    string |
    null;

  sourceTreeSha256:
    string;

  testResult: {
    count: number;
    passed: number;
    failed: number;
  };

  releaseSurfaceOk:
    boolean;

  manifestSha256:
    string;
}

async function main():
  Promise<void> {
  const [
    outputFlag,
    outputPath,
  ] = process.argv.slice(2);

  if (
    outputFlag !== '--output' ||
    !outputPath
  ) {
    throw new Error(
      [
        'Usage:',
        'npm run release:manifest -- ',
        '--output <FILE>',
      ].join('')
    );
  }

  const root =
    process.cwd();

  const gitCommit =
    getGitCommit();

  const lockfileSha256 =
    await getFileHash(
      join(root, 'package-lock.json')
    );

  const sourceTreeSha256 =
    await computeSourceTreeHash(
      root
    );

  const testResult =
    await getTestCount();

  const releaseSurface =
    await getReleaseSurfaceResult();

  const withoutHash:
    Omit<
      ReleaseManifest,
      'manifestSha256'
    > = {
      version: 1,

      gitCommit,
      buildTimestamp:
        new Date()
          .toISOString(),

      nodeVersion:
        getNodeVersion(),

      npmVersion:
        getNpmVersion(),

      lockfileSha256,
      sourceTreeSha256,

      testResult,
      releaseSurfaceOk:
        releaseSurface.ok,
    };

  const manifest:
    ReleaseManifest = {
      ...withoutHash,

      manifestSha256:
        sha256(
          stableStringify(
            withoutHash
          )
        ),
    };

  await writeFile(
    outputPath,
    JSON.stringify(
      manifest,
      null,
      2
    ),
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );

  await chmod(
    outputPath,
    0o600
  );

  console.log(
    [
      'RELEASE MANIFEST GENERATED',
      `Commit: ${manifest.gitCommit}`,
      `SourceTree: ${manifest.sourceTreeSha256.slice(0, 16)}...`,
      `Tests: ${manifest.testResult.passed}/${manifest.testResult.count}`,
      `ReleaseSurface: ${manifest.releaseSurfaceOk ? 'OK' : 'FAIL'}`,
      `Manifest: ${manifest.manifestSha256.slice(0, 16)}...`,
      `Output: ${outputPath}`,
    ].join(' | ')
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      `Release manifest generation failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 1;
  }
);
