import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
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

function isErrnoException(
  error: unknown
): error is NodeJS.ErrnoException {
  return (
    error instanceof Error &&
    'code' in error
  );
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

function parseSecretBuffer(
  content: Buffer
): Uint8Array {
  const text =
    content
      .toString('utf8')
      .trim();

  if (!text) {
    throw new Error(
      'Private key is empty'
    );
  }

  if (text.startsWith('[')) {
    return parseJsonSecret(text);
  }

  let decoded: Uint8Array;

  try {
    decoded = bs58.decode(text);
  } catch {
    throw new Error(
      'Private key is not valid base58 or JSON'
    );
  }

  if (decoded.length !== 64) {
    const receivedLength =
      decoded.length;

    decoded.fill(0);

    throw new Error(
      `Decoded private key has ${receivedLength} bytes; expected 64`
    );
  }

  return decoded;
}

function validateOpenedFile(
  fileDescriptor: number
): void {
  const info =
    fstatSync(fileDescriptor);

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

  if (process.platform !== 'win32') {
    const exposedPermissions =
      info.mode & 0o077;

    if (exposedPermissions !== 0) {
      throw new Error(
        [
          'PRIVATE_KEY_FILE permissions are too open.',
          'Run chmod 600 on the private-key file.',
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

function readSecureKeyFile(
  path: string
): Buffer {
  /*
   * Keep the explicit lstat check for a clear error
   * message. O_NOFOLLOW below provides the actual
   * race-resistant protection.
   */
  const pathInfo = lstatSync(path);

  if (pathInfo.isSymbolicLink()) {
    throw new Error(
      'PRIVATE_KEY_FILE must not be a symbolic link'
    );
  }

  const noFollowFlag =
    process.platform === 'win32'
      ? 0
      : constants.O_NOFOLLOW;

  let fileDescriptor: number;

  try {
    fileDescriptor = openSync(
      path,
      constants.O_RDONLY |
        noFollowFlag
    );
  } catch (error) {
    if (
      isErrnoException(error) &&
      error.code === 'ELOOP'
    ) {
      throw new Error(
        'PRIVATE_KEY_FILE must not be a symbolic link'
      );
    }

    throw error;
  }

  try {
    /*
     * Validate the exact object represented by this
     * descriptor, then read from the same descriptor.
     * Replacing the path cannot change what is read.
     */
    validateOpenedFile(
      fileDescriptor
    );

    const content =
      readFileSync(fileDescriptor);

    if (!Buffer.isBuffer(content)) {
      throw new Error(
        'PRIVATE_KEY_FILE did not return binary content'
      );
    }

    return content;
  } finally {
    closeSync(fileDescriptor);
  }
}

function keypairFromBuffer(
  content: Buffer
): Keypair {
  let secret:
    | Uint8Array
    | undefined;

  try {
    secret =
      parseSecretBuffer(content);

    return Keypair.fromSecretKey(
      secret
    );
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error(
      'Private key could not create a Solana keypair'
    );
  } finally {
    if (secret) {
      secret.fill(0);
    }

    /*
     * Clear the file/environment byte buffer even
     * when parsing or Keypair construction fails.
     */
    content.fill(0);
  }
}

function keypairFromEnvironment(
  value: string
): Keypair {
  const buffer = Buffer.from(
    value,
    'utf8'
  );

  return keypairFromBuffer(buffer);
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
    const content =
      readSecureKeyFile(
        privateKeyFile
      );

    return keypairFromBuffer(
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

    return keypairFromEnvironment(
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
