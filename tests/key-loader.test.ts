import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chmod,
  mkdtemp,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';

import {
  tmpdir,
} from 'node:os';

import {
  join,
} from 'node:path';

import bs58 from 'bs58';

import {
  Keypair,
} from '@solana/web3.js';

import {
  loadConfiguredKeypair,
} from '../sniper/key-loader.js';

async function temporaryDirectory(): Promise<string> {
  return mkdtemp(
    join(
      tmpdir(),
      'sniper-key-test-'
    )
  );
}

test(
  'loads a secure base58 key file',
  async () => {
    const directory =
      await temporaryDirectory();

    const path = join(
      directory,
      'wallet.key'
    );

    const expected =
      Keypair.generate();

    await writeFile(
      path,
      bs58.encode(
        expected.secretKey
      ),
      {
        encoding: 'utf8',
        mode: 0o600,
      }
    );

    const loaded =
      loadConfiguredKeypair({
        liveTrading: true,
        privateKeyFile: path,
        allowEnvironmentPrivateKey:
          false,
      });

    assert.ok(loaded);

    assert.equal(
      loaded.publicKey.toBase58(),
      expected.publicKey.toBase58()
    );
  }
);

test(
  'loads a secure JSON key file',
  async () => {
    const directory =
      await temporaryDirectory();

    const path = join(
      directory,
      'wallet.json'
    );

    const expected =
      Keypair.generate();

    await writeFile(
      path,
      JSON.stringify(
        [...expected.secretKey]
      ),
      {
        encoding: 'utf8',
        mode: 0o600,
      }
    );

    const loaded =
      loadConfiguredKeypair({
        liveTrading: true,
        privateKeyFile: path,
        allowEnvironmentPrivateKey:
          false,
      });

    assert.ok(loaded);

    assert.equal(
      loaded.publicKey.toBase58(),
      expected.publicKey.toBase58()
    );
  }
);

test(
  'rejects group-readable key files',
  async () => {
    if (
      process.platform === 'win32'
    ) {
      return;
    }

    const directory =
      await temporaryDirectory();

    const path = join(
      directory,
      'wallet.key'
    );

    const keypair =
      Keypair.generate();

    await writeFile(
      path,
      bs58.encode(
        keypair.secretKey
      ),
      'utf8'
    );

    await chmod(
      path,
      0o640
    );

    assert.throws(
      () =>
        loadConfiguredKeypair({
          liveTrading: true,
          privateKeyFile: path,
          allowEnvironmentPrivateKey:
            false,
        }),
      /permissions are too open/
    );
  }
);

test(
  'rejects symbolic-link key files',
  async () => {
    if (
      process.platform === 'win32'
    ) {
      return;
    }

    const directory =
      await temporaryDirectory();

    const realPath = join(
      directory,
      'real.key'
    );

    const linkPath = join(
      directory,
      'linked.key'
    );

    const keypair =
      Keypair.generate();

    await writeFile(
      realPath,
      bs58.encode(
        keypair.secretKey
      ),
      {
        encoding: 'utf8',
        mode: 0o600,
      }
    );

    await symlink(
      realPath,
      linkPath
    );

    try {
      assert.throws(
        () =>
          loadConfiguredKeypair({
            liveTrading: true,
            privateKeyFile:
              linkPath,
            allowEnvironmentPrivateKey:
              false,
          }),
        /must not be a symbolic link/
      );
    } finally {
      await unlink(linkPath);
    }
  }
);

test(
  'rejects environment key by default',
  () => {
    const keypair =
      Keypair.generate();

    assert.throws(
      () =>
        loadConfiguredKeypair({
          liveTrading: true,

          privateKeyEnv:
            bs58.encode(
              keypair.secretKey
            ),

          allowEnvironmentPrivateKey:
            false,
        }),
      /Environment private keys are disabled/
    );
  }
);

test(
  'dry-run works without any private key',
  () => {
    const result =
      loadConfiguredKeypair({
        liveTrading: false,
        allowEnvironmentPrivateKey:
          false,
      });

    assert.equal(
      result,
      null
    );
  }
);
