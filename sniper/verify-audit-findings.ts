export {};

import {
  readFile,
} from 'node:fs/promises';

import {
  join,
} from 'node:path';

interface AuditFinding {
  id: string;
  severity:
    | 'critical'
    | 'high'
    | 'medium'
    | 'low'
    | 'info';
  status:
    | 'open'
    | 'resolved'
    | 'suppressed';
  summary: string;
  fixCommit: string | null;
  suppressionRationale?: string;
  suppressionExpiry?: string;
}

async function main():
  Promise<void> {
  const findingsPath =
    join(
      process.cwd(),
      'security',
      'audit-findings.json'
    );

  let findings:
    AuditFinding[];

  try {
    const content =
      await readFile(
        findingsPath,
        'utf8'
      );

    findings =
      JSON.parse(content) as AuditFinding[];
  } catch {
    console.error(
      'No security/audit-findings.json found'
    );

    process.exitCode = 2;

    return;
  }

  const errors:
    string[] = [];

  const now =
    Date.now();

  for (
    const finding of
    findings
  ) {
    if (
      finding.status ===
        'open' &&
      (
        finding.severity ===
          'critical' ||
        finding.severity ===
          'high'
      )
    ) {
      errors.push(
        `Unresolved ${finding.severity} finding: ${finding.id} — ${finding.summary}`
      );
    }

    if (
      finding.status ===
        'suppressed'
    ) {
      if (
        !finding
          .suppressionRationale
      ) {
        errors.push(
          `Suppressed finding ${finding.id} has no rationale`
        );
      }

      if (
        !finding
          .suppressionExpiry
      ) {
        errors.push(
          `Suppressed finding ${finding.id} has no expiry`
        );
      } else {
        const expiryMs =
          Date.parse(
            finding
              .suppressionExpiry
          );

        if (
          !Number.isFinite(
            expiryMs
          )
        ) {
          errors.push(
            `Suppressed finding ${finding.id} has invalid expiry`
          );
        } else if (
          expiryMs <
          now
        ) {
          errors.push(
            `Suppressed finding ${finding.id} has expired`
          );
        }
      }
    }
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

  const openCount =
    findings.filter(
      (f) =>
        f.status === 'open'
    ).length;

  const resolvedCount =
    findings.filter(
      (f) =>
        f.status === 'resolved'
    ).length;

  console.log(
    [
      'AUDIT GATE PASSED',
      `Total: ${findings.length}`,
      `Open: ${openCount}`,
      `Resolved: ${resolvedCount}`,
    ].join(' | ')
  );
}

main().catch(
  (error: unknown) => {
    console.error(
      `Audit gate failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 2;
  }
);
