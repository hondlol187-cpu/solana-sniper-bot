import {
  appendFile,
  chmod,
} from 'node:fs/promises';

import { config } from './config.js';

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
