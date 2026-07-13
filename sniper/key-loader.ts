import {
  lstatSync,
  readFileSync,
  statSync,
} from 'node:fs';

import bs58 from 'bs58';

import {
  Keypair,
} from '@solana/web3.js';

export interface KeyLoaderOptions {
  liveTrading: boolean;

  privateKeyEnv?: string;
  privateKeyFile?: string;

  allowEnvironmentPrivateKey:
    boolean;
}

function parseJsonSecret(
  content: string
): Uint8Array {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      'Private-key JSON is invalid'
    );
  }

  if (
    !Array.isArray(parsed) ||
    parsed.length !== 64
  ) {
    throw new Error(
      'Private-key JSON must contain exactly 64 bytes'
    );
  }

  const bytes = parsed.map(
    (value) => {
      if (
        !Number.isInteger(value) ||
        value < 0 ||
        value > 255
      ) {
        throw new Error(
          'Private-key JSON contains an invalid byte'
        );
      }

      return value;
    }
  );

  return Uint8Array.from(bytes);
}

function parseSecret(
  content: string
): Uint8Array {
  const trimmed = content.trim();

  if (!trimmed) {
    throw new Error(
      'Private key is empty'
    );
  }

  if (trimmed.startsWith('[')) {
    return parseJsonSecret(
      trimmed
    );
  }

  let decoded: Uint8Array;

  try {
    decoded = bs58.decode(
      trimmed
    );
  } catch {
    throw new Error(
      'Private key is not valid base58 or JSON'
    );
  }

  if (decoded.length !== 64) {
    decoded.fill(0);

    throw new Error(
      `Decoded private key has ${decoded.length} bytes; expected 64`
    );
  }

  return decoded;
}

function assertSecureKeyFile(
  path: string
): void {
  const linkInfo =
    lstatSync(path);

  if (linkInfo.isSymbolicLink()) {
    throw new Error(
      'PRIVATE_KEY_FILE must not be a symbolic link'
    );
  }

  const info = statSync(path);

  if (!info.isFile()) {
    throw new Error(
      'PRIVATE_KEY_FILE is not a regular file'
    );
  }

  if (info.size <= 0) {
    throw new Error(
      'PRIVATE_KEY_FILE is empty'
    );
  }

  if (info.size > 4_096) {
    throw new Error(
      'PRIVATE_KEY_FILE is unexpectedly large'
    );
  }

  /*
   * Skip POSIX permission checks only on Windows.
   */
  if (process.platform !== 'win32') {
    const exposedPermissions =
      info.mode & 0o077;

    if (exposedPermissions !== 0) {
      throw new Error(
        [
          'PRIVATE_KEY_FILE permissions are too open.',
          'Run: chmod 600 <private-key-file>',
        ].join(' ')
      );
    }

    if (
      typeof process.getuid ===
        'function' &&
      info.uid !== process.getuid()
    ) {
      throw new Error(
        'PRIVATE_KEY_FILE is not owned by the current user'
      );
    }
  }
}

function keypairFromContent(
  content: string
): Keypair {
  const secret =
    parseSecret(content);

  try {
    return Keypair.fromSecretKey(
      secret
    );
  } catch {
    throw new Error(
      'Private key could not create a Solana keypair'
    );
  } finally {
    /*
     * Reduce the time raw secret bytes remain in
     * application-controlled memory.
     */
    secret.fill(0);
  }
}

export function loadConfiguredKeypair(
  options: KeyLoaderOptions
): Keypair | null {
  const privateKeyEnv =
    options.privateKeyEnv?.trim();

  const privateKeyFile =
    options.privateKeyFile?.trim();

  if (
    privateKeyEnv &&
    privateKeyFile
  ) {
    throw new Error(
      'Set PRIVATE_KEY_FILE or PRIVATE_KEY, not both'
    );
  }

  if (privateKeyFile) {
    assertSecureKeyFile(
      privateKeyFile
    );

    const content = readFileSync(
      privateKeyFile,
      {
        encoding: 'utf8',
      }
    );

    return keypairFromContent(
      content
    );
  }

  if (privateKeyEnv) {
    if (
      !options
        .allowEnvironmentPrivateKey
    ) {
      throw new Error(
        [
          'Environment private keys are disabled.',
          'Use PRIVATE_KEY_FILE with chmod 600.',
          'Set ALLOW_ENV_PRIVATE_KEY=true only for temporary migration.',
        ].join(' ')
      );
    }

    return keypairFromContent(
      privateKeyEnv
    );
  }

  if (options.liveTrading) {
    throw new Error(
      'PRIVATE_KEY_FILE is required when LIVE_TRADING=true'
    );
  }

  return null;
}
