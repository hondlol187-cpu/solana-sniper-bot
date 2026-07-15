export {};

import { execSync } from 'node:child_process';

interface GateResult {
  name: string;
  ok: boolean;
  output: string;
  durationMs: number;
}

function runGate(
  name: string,
  command: string
): GateResult {
  const start = Date.now();

  try {
    const output = execSync(command, {
      encoding: 'utf8',
      timeout: 120_000,
      cwd: process.cwd(),
      env: { ...process.env },
    });

    return {
      name,
      ok: true,
      output: output.trim(),
      durationMs: Date.now() - start,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      output:
        error instanceof Error
          ? error.message
          : String(error),
      durationMs: Date.now() - start,
    };
  }
}

async function main(): Promise<void> {
  const gates: GateResult[] = [];

  const releaseSurface = runGate(
    'release-surface',
    'npm run verify:release-surface 2>&1'
  );

  gates.push(releaseSurface);

  const auditFindings = runGate(
    'audit-findings',
    'npm run verify:audit-findings 2>&1'
  );

  gates.push(auditFindings);

  const manifestDir = process.argv[2];

  if (manifestDir) {
    const manifestPath = `${manifestDir}/release-manifest.json`;

    const manifestGen = runGate(
      'release-manifest-generate',
      `npm run release:manifest -- --output ${manifestPath} 2>&1`
    );

    gates.push(manifestGen);

    if (manifestGen.ok) {
      const manifestVerify = runGate(
        'release-manifest-verify',
        `npm run release:verify -- ${manifestPath} 2>&1`
      );

      gates.push(manifestVerify);
    }
  }

  const failed = gates.filter((g) => !g.ok);
  const passed = gates.filter((g) => g.ok);

  const totalDurationMs = gates.reduce(
    (sum, g) => sum + g.durationMs,
    0
  );

  console.log('='.repeat(60));
  console.log('RELEASE GATE SUMMARY');
  console.log('='.repeat(60));

  for (const gate of gates) {
    const status = gate.ok ? 'PASS' : 'FAIL';
    console.log(
      `  [${status}] ${gate.name} (${gate.durationMs}ms)`
    );

    if (!gate.ok) {
      const lines = gate.output
        .split('\n')
        .filter((line) => line.trim().startsWith('ERROR:'));

      for (const line of lines) {
        console.log(`         ${line.trim()}`);
      }
    }
  }

  console.log('-'.repeat(60));
  console.log(
    `  Total: ${gates.length} gates, ${passed.length} passed, ${failed.length} failed`
  );
  console.log(
    `  Duration: ${totalDurationMs}ms`
  );
  console.log('='.repeat(60));

  if (failed.length > 0) {
    console.error(
      `\nRELEASE GATES FAILED: ${failed.map((g) => g.name).join(', ')}`
    );

    process.exitCode = 1;
  } else {
    console.log('\nALL RELEASE GATES PASSED');
  }
}

main().catch((error: unknown) => {
  console.error(
    `Release gate runner failed: ${
      error instanceof Error
        ? error.message
        : String(error)
    }`
  );

  process.exitCode = 2;
});