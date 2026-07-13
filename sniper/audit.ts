import {
  appendFile,
  chmod,
  readFile,
} from 'node:fs/promises';

import { config } from './config.js';
import { withFileLock } from './file-lock.js';

const secretNames = new Set([
  'privatekey',
  'secret',
  'seed',
  'authorization',
  'apikey',
  'api_key',
  'token',
  'password',
]);

function redact(
  value: unknown,
  depth = 0
): unknown {
  if (depth > 6) {
    return '[MAX_DEPTH]';
  }

  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'string') {
    return value.length > 500
      ? `${value.slice(0, 500)}…`
      : value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item) =>
        redact(item, depth + 1)
      );
  }

  if (typeof value === 'object') {
    const output: Record<
      string,
      unknown
    > = {};

    for (
      const [key, child] of Object.entries(
        value as Record<string, unknown>
      )
    ) {
      if (
        secretNames.has(
          key.toLowerCase()
        )
      ) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = redact(
          child,
          depth + 1
        );
      }
    }

    return output;
  }

  return String(value);
}

export async function audit(
  event: string,
  details: Record<
    string,
    unknown
  > = {}
): Promise<void> {
  const entry = {
    timestamp:
      new Date().toISOString(),
    pid: process.pid,
    event,
    details: redact(details),
  };

  await appendFile(
    config.auditFile,
    `${JSON.stringify(entry)}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );

  /*
   * appendFile does not always update permissions
   * when the file already existed.
   */
  await chmod(
    config.auditFile,
    0o600
  );
}

/**
 * Idempotent audit write. Checks whether an audit
 * event with the given `auditEventId` already exists
 * in the audit file before appending. If it exists,
 * the event is NOT re-written (exactly-once).
 *
 * The check + append is atomic under the audit file
 * lock so concurrent callers cannot both pass the
 * check and both append.
 *
 * Returns { written: true } if the event was newly
 * appended, { written: false } if it already existed.
 */
export async function auditOnce(
  event: string,
  auditEventId: string,
  details: Record<
    string,
    unknown
  > = {}
): Promise<{ written: boolean }> {
  return withFileLock(
    config.auditFile + '.lock',
    async () => {
      /*
       * Read the audit file and check whether
       * auditEventId already appears in any
       * entry's details.
       */
      try {
        const content =
          await readFile(
            config.auditFile,
            'utf8'
          );

        for (const line of content.split(
          '\n'
        )) {
          const trimmed = line.trim();

          if (!trimmed) continue;

          try {
            const entry = JSON.parse(
              trimmed
            ) as {
              details?: {
                auditEventId?: unknown;
              };
            };

            if (
              entry.details
                ?.auditEventId ===
              auditEventId
            ) {
              return {
                written: false,
              };
            }
          } catch {
            /*
             * Skip malformed lines —
             * they can't contain the
             * event ID.
             */
          }
        }
      } catch {
        /*
         * Audit file doesn't exist yet —
         * proceed to write.
         */
      }

      /*
       * Event ID not found — append the event.
       */
      await audit(event, {
        ...details,
        auditEventId,
      });

      return { written: true };
    }
  );
}
