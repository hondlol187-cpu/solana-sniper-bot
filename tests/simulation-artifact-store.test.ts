import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile,
  rm,
  lstat,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  VersionedTransaction,
  MessageV0,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';

let configured = false;
let planDir: string;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-artifact-store-')
  );

  planDir = join(dir, 'plans');

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';
  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_DIR =
    planDir;
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS =
    '30';

  configured = true;
}

async function cleanAll() {
  await configureEnvironment();

  await rm(planDir, {
    force: true,
    recursive: true,
  });

  await mkdir(planDir, {
    recursive: true,
    mode: 0o700,
  });
}

const WALLET =
  '11111111111111111111111111111111';
const POOL =
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const RECENT_BLOCKHASH =
  '9WzDXwBbmkg8ZTbNMqJxHBWu3jJ4a8m8mC7qPvR6e8Qx';
const COMPUTE_BUDGET_PROGRAM =
  'ComputeBudget111111111111111111111111111111';

function buildTransaction(): Buffer {
  const feePayer = new PublicKey(WALLET);
  const poolKey = new PublicKey(POOL);

  const cuLimitData = Buffer.alloc(5);
  cuLimitData[0] = 2;
  cuLimitData.writeUInt32LE(100_000, 1);

  const message = MessageV0.compile({
    payerKey: feePayer,
    instructions: [
      new TransactionInstruction({
        keys: [
          {
            pubkey: feePayer,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: poolKey,
            isSigner: false,
            isWritable: true,
          },
        ],
        programId: new PublicKey(
          COMPUTE_BUDGET_PROGRAM
        ),
        data: cuLimitData,
      }),
    ],
    recentBlockhash: RECENT_BLOCKHASH,
    addressLookupTableAccounts: [],
  });

  const transaction =
    new VersionedTransaction(message);

  return Buffer.from(transaction.serialize());
}

function buildInput(
  overrides: Record<string, unknown> = {}
) {
  return {
    planId: 'test-plan-id',
    planInstanceId: 'test-instance-id',
    planSha256BeforeSimulation: 'a'.repeat(64),
    serializedTransaction: buildTransaction(),
    simulationResponse: {
      contextSlot: 123_456,
      err: null,
      logs: ['log1', 'log2'],
      unitsConsumed: 50_000,
    },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

test(
  'persists exact transaction bytes',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      persistSimulationArtifact,
      loadSimulationArtifact,
    } = await import(
      '../sniper/simulation-artifact-store.js'
    );

    const input = buildInput();
    const stored =
      await persistSimulationArtifact(input);

    assert.ok(stored.artifactId);
    assert.ok(stored.artifactSha256);

    const loaded =
      await loadSimulationArtifact(
        stored.artifactId
      );

    assert.equal(
      loaded.artifactSha256,
      stored.artifactSha256
    );

    const bytes = Buffer.from(
      loaded.serializedTransactionBase64,
      'base64'
    );

    assert.deepEqual(
      bytes,
      input.serializedTransaction
    );
  }
);

test(
  'same artifact write is idempotent',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      persistSimulationArtifact,
    } = await import(
      '../sniper/simulation-artifact-store.js'
    );

    const input = buildInput();
    const first =
      await persistSimulationArtifact(input);
    const second =
      await persistSimulationArtifact(input);

    assert.equal(
      first.artifactId,
      second.artifactId
    );
    assert.equal(
      first.artifactSha256,
      second.artifactSha256
    );
  }
);

test(
  'conflicting artifact is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      persistSimulationArtifact,
    } = await import(
      '../sniper/simulation-artifact-store.js'
    );

    const input = buildInput();
    await persistSimulationArtifact(input);

    /*
     * Same artifactId (deterministic from planInstanceId +
     * serializedTransactionSha256) but different plan hash.
     */
    const conflicting = buildInput({
      planSha256BeforeSimulation: 'b'.repeat(64),
    });

    await assert.rejects(
      persistSimulationArtifact(conflicting),
      /Conflicting simulation artifact/i
    );
  }
);

test(
  'tampered artifact hash is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      persistSimulationArtifact,
      loadSimulationArtifact,
      getSimulationArtifactPath,
    } = await import(
      '../sniper/simulation-artifact-store.js'
    );

    const input = buildInput();
    const stored =
      await persistSimulationArtifact(input);

    const path =
      getSimulationArtifactPath(
        stored.artifactId
      );

    const parsed = JSON.parse(
      await readFile(path, 'utf8')
    );

    parsed.planSha256BeforeSimulation =
      'c'.repeat(64);

    await writeFile(
      path,
      JSON.stringify(parsed, null, 2),
      'utf8'
    );

    await assert.rejects(
      loadSimulationArtifact(
        stored.artifactId
      ),
      /hash mismatch/i
    );
  }
);

test(
  'tampered transaction bytes are rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      persistSimulationArtifact,
      loadSimulationArtifact,
      getSimulationArtifactPath,
    } = await import(
      '../sniper/simulation-artifact-store.js'
    );

    const input = buildInput();
    const stored =
      await persistSimulationArtifact(input);

    const path =
      getSimulationArtifactPath(
        stored.artifactId
      );

    const parsed = JSON.parse(
      await readFile(path, 'utf8')
    );

    /*
     * Tamper with the base64 but keep it valid
     * base64 (just wrong content). The hash check
     * and deserialization check will catch it.
     */
    parsed.serializedTransactionBase64 =
      Buffer.from('tampered').toString('base64');

    await writeFile(
      path,
      JSON.stringify(parsed, null, 2),
      'utf8'
    );

    await assert.rejects(
      loadSimulationArtifact(
        stored.artifactId
      ),
      /hash mismatch|invalid transaction/i
    );
  }
);

test(
  'artifact from another plan instance is rejected by loadVerifiedArtifactBytes',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      persistSimulationArtifact,
      loadVerifiedArtifactBytes,
    } = await import(
      '../sniper/simulation-artifact-store.js'
    );

    const input = buildInput();
    const stored =
      await persistSimulationArtifact(input);

    const receipt = {
      artifactId: stored.artifactId,
      artifactSha256: stored.artifactSha256,
      serializedTransactionSha256:
        stored.artifactSha256,
      planSha256BeforeSimulation:
        input.planSha256BeforeSimulation,
    } as any;

    await assert.rejects(
      loadVerifiedArtifactBytes(
        receipt,
        'test-plan-id',
        'wrong-instance-id'
      ),
      /different plan instance/i
    );
  }
);

test(
  'artifact file mode is 0600',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      persistSimulationArtifact,
      getSimulationArtifactPath,
    } = await import(
      '../sniper/simulation-artifact-store.js'
    );

    const input = buildInput();
    const stored =
      await persistSimulationArtifact(input);

    const path =
      getSimulationArtifactPath(
        stored.artifactId
      );

    const stats = await lstat(path);

    /*
     * File mode bits: 0o600 = 0o100000 | 0o600
     */
    const mode = stats.mode & 0o777;

    assert.equal(
      mode,
      0o600,
      `File mode should be 0600, got ${mode.toString(8)}`
    );
  }
);

test(
  'artifact symlink is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      persistSimulationArtifact,
      loadSimulationArtifact,
      getSimulationArtifactPath,
    } = await import(
      '../sniper/simulation-artifact-store.js'
    );

    const input = buildInput();
    const stored =
      await persistSimulationArtifact(input);

    const path =
      getSimulationArtifactPath(
        stored.artifactId
      );

    /*
     * Replace the file with a symlink.
     */
    await rm(path);
    await symlink('/dev/null', path);

    await assert.rejects(
      loadSimulationArtifact(
        stored.artifactId
      ),
      /symbolic link/i
    );
  }
);
