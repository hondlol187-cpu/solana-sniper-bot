import {
  config,
} from './config.js';

import {
  audit,
} from './audit.js';

import {
  join,
} from 'node:path';

import {
  readFile,
  writeFile,
  lstat,
  chmod,
} from 'node:fs/promises';

function stopFilePath():
  string {
  return join(
    config
      .approvedExecutionPlanDir,
    'EMERGENCY-STOP'
  );
}

export async function isEmergencyStopActive():
  Promise<boolean> {
  try {
    const info =
      await lstat(
        stopFilePath()
      );

    if (
      info.isSymbolicLink()
    ) {
      throw new Error(
        'Emergency stop file must not be a symbolic link'
      );
    }

    return info.isFile();
  } catch (error) {
    if (
      (
        error as {
          code?: string;
        }
      ).code === 'ENOENT'
    ) {
      return false;
    }

    throw error;
  }
}

export async function assertEmergencyStopNotActive(
  checkpoint: string
): Promise<void> {
  const active =
    await isEmergencyStopActive();

  if (active) {
    await audit(
      'emergency-stop.blocked',
      {
        checkpoint,
      }
    );

    throw new Error(
      `Emergency stop is active; execution blocked at ${checkpoint}`
    );
  }
}

export async function activateEmergencyStop():
  Promise<void> {
  const path =
    stopFilePath();

  await writeFile(
    path,
    `Emergency stop activated at ${new Date().toISOString()}\n`,
    {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    }
  );

  await chmod(
    path,
    0o600
  );

  await audit(
    'emergency-stop.activated',
    {}
  );
}
