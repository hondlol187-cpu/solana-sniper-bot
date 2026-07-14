import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
  writeFile,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { spawnSync } from 'node:child_process';

let configured = false;
let planDir: string;
let testDir: string;

const PLAN_ID = 'test-plan-cli-1';
const PLAN_INSTANCE_ID =
  'test-instance-cli-1';
const ARTIFACT_ID = 'test-artifact-cli-1';

const SIGNED_TX_SHA = 'a'.repeat(64);
const MSG_SHA = 'b'.repeat(64);
const LAST_VALID_BLOCK_HEIGHT = 200_000_000;

async function configureEnvironment() {
  if (configured) return;

  testDir = await mkdtemp(
    join(
      tmpdir(),
      'sniper-execute-cli-'
    )
  );

  planDir = join(testDir, 'plans');

  process.env.LIVE_TRADING =
    'false';
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

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

let keyFilePath: string;
let keyFileWallet: string;

async function ensureKeyFile() {
  if (keyFilePath) return;

  const { Keypair } =
    await import(
      '@solana/web3.js'
    );

  const keypair = Keypair.generate();

  keyFileWallet =
    keypair.publicKey.toBase58();

  keyFilePath = join(
    testDir,
    'private-key.json'
  );

  const { chmod } =
    await import(
      'node:fs/promises'
    );

  await writeFile(
    keyFilePath,
    JSON.stringify(
      Array.from(
        keypair.secretKey
      )
    ),
    {
      encoding: 'utf8',
      mode: 0o600,
    }
  );

  /*
   * writeFile mode is masked by umask; force 0600.
   */
  await chmod(keyFilePath, 0o600);
}

function runCli(
  args: string[],
  envOverrides: Record<
    string,
    string
  > = {}
): CliResult {
  const env = {
    ...process.env,
    ...envOverrides,
  };

  const result = spawnSync(
    process.execPath,
    [
      join(
        process.cwd(),
        'node_modules/tsx/dist/cli.mjs'
      ),
      'sniper/execute-simulated-plan.ts',
      ...args,
    ],
    {
      cwd: process.cwd(),
      env,
      encoding: 'utf8',
    }
  );

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

/*
 * Minimal plan file shape. We only need enough for
 * loadApprovedExecutionPlan to succeed and for the
 * CLI to reach the confirmation-phrase check.
 */
function buildPlanFile(
  overrides: {
    status?: string;
    artifactId?: string;
    walletPublicKey?: string;
    simulationReceipt?: unknown | null;
  } = {}
) {
  const wallet =
    overrides.walletPublicKey ??
    '11111111111111111111111111111111';

  const receipt =
    overrides.simulationReceipt ===
    undefined
      ? {
          transactionMessageSha256:
            MSG_SHA,
          serializedTransactionSha256:
            'c'.repeat(64),
          recentBlockhash:
            '11111111111111111111111111111111',
          lastValidBlockHeight:
            LAST_VALID_BLOCK_HEIGHT,
          simulatedAt:
            new Date().toISOString(),
          rpcEndpoint:
            'https://api.mainnet-beta.solana.com',
          contextSlot: 1,
          err: null,
          logsSha256: 'd'.repeat(64),
          walletPublicKey: wallet,
          expectedCluster:
            'mainnet-beta',
          planSha256BeforeSimulation:
            'e'.repeat(64),
          transactionPolicyOk: true,
          transactionPolicySha256:
            'f'.repeat(64),
          artifactId:
            overrides.artifactId ??
            ARTIFACT_ID,
          artifactSha256: '1'.repeat(64),
        }
      : overrides.simulationReceipt;

  return {
    version: 3,
    diskVersion: 3 as const,
    planId: PLAN_ID,
    planInstanceId: PLAN_INSTANCE_ID,
    state: {
      status:
        overrides.status ?? 'simulated',
      simulationCount: 1,
      createdAt:
        new Date(
          Date.now() - 1_000
        ).toISOString(),
      simulatedAt:
        new Date().toISOString(),
      simulationReceipt: receipt,
    },
    payload: {
      signature: 'sig-cli-1',
      exactMint: 'BASE_1',
      createdAt:
        new Date(
          1_000_000
        ).toISOString(),
      quoteReceivedAtMs: 995_000,
      walletPublicKey: wallet,
      expectedCluster: 'mainnet-beta',
      buyLamports: '10000000',
      approvedPoolAddress: 'POOL_1',
      approvedQuoteMint:
        'So11111111111111111111111111111111111111112',
      approvedLiquiditySol: 100,
      currentPoolAddress: 'POOL_1',
      currentQuoteMint:
        'So11111111111111111111111111111111111111112',
      currentLiquiditySol: 90,
      routeHopCount: 1,
      routeLabels: ['Raydium AMM'],
      routeAmmKeys: ['POOL_1'],
      quoteInputMint:
        'So11111111111111111111111111111111111111112',
      quoteOutputMint: 'BASE_1',
      quoteInAmount: '10000000',
      quoteOutAmount: '1000000',
      quoteOtherAmountThreshold:
        '900000',
      quoteSlippageBps: 150,
      quotePriceImpactPct: '0.5',
      quoteRoutePlan: [],
      routeOk: true,
      routeReasons: [],
      approvalOk: true,
      approvalReasons: [],
      quoteAgeMs: 100,
    },
    sha256: '',
  };
}

async function writePlan(
  plan: ReturnType<
    typeof buildPlanFile
  >
) {
  const { createHash } =
    await import('node:crypto');

  const { getApprovedExecutionPlanPath } =
    await import(
      '../sniper/execution-plan.js'
    );

  const path =
    getApprovedExecutionPlanPath(
      plan.planId
    );

  const stableStringify = (
    value: unknown
  ): string => {
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

    const entries = Object.entries(
      value as Record<
        string,
        unknown
      >
    )
      .filter(
        ([, v]) =>
          v !== undefined
      )
      .sort(([a], [b]) =>
        a.localeCompare(b)
      );

    return `{${entries
      .map(
        ([k, v]) =>
          `${JSON.stringify(k)}:${stableStringify(v)}`
      )
      .join(',')}}`;
  };

  const hash = createHash(
    'sha256'
  )
    .update(
      stableStringify({
        version: 3,
        planId: plan.planId,
        planInstanceId:
          plan.planInstanceId,
        state: plan.state,
        payload: plan.payload,
      })
    )
    .digest('hex');

  const withHash = {
    ...plan,
    sha256: hash,
  };

  await mkdir(
    join(path, '..'),
    {
      recursive: true,
      mode: 0o700,
    }
  );

  await writeFile(
    path,
    JSON.stringify(
      withHash,
      null,
      2
    ),
    'utf8'
  );

  return withHash;
}

test(
  'incorrect confirmation phrase rejects before execution',
  async () => {
    await configureEnvironment();
    await cleanAll();
    await ensureKeyFile();

    const plan = buildPlanFile({
      walletPublicKey: keyFileWallet,
    });
    await writePlan(plan);

    const result = runCli(
      [
        plan.planId,
        '--live',
        'CONFIRM:wrong:wrong:wrong:wrong',
      ],
      {
        LIVE_TRADING: 'true',
        ENABLE_MAINNET_EXECUTION: 'true',
        PRIVATE_KEY_FILE: keyFilePath,
        WALLET_PUBLIC_KEY: keyFileWallet,
      }
    );

    assert.notEqual(
      result.status,
      0
    );

    assert.match(
      result.stderr,
      /Exact confirmation phrase required/i
    );
  }
);

test(
  'missing artifact rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();
    await ensureKeyFile();

    const plan = buildPlanFile({
      walletPublicKey: keyFileWallet,
      simulationReceipt: {
        transactionMessageSha256:
          MSG_SHA,
        serializedTransactionSha256:
          'c'.repeat(64),
        recentBlockhash:
          '11111111111111111111111111111111',
        lastValidBlockHeight:
          LAST_VALID_BLOCK_HEIGHT,
        simulatedAt:
          new Date().toISOString(),
        rpcEndpoint:
          'https://api.mainnet-beta.solana.com',
        contextSlot: 1,
        err: null,
        logsSha256: 'd'.repeat(64),
        walletPublicKey: keyFileWallet,
        expectedCluster: 'mainnet-beta',
        planSha256BeforeSimulation:
          'e'.repeat(64),
        transactionPolicyOk: true,
        transactionPolicySha256:
          'f'.repeat(64),
        /*
         * No artifactId — the CLI must reject
         * before reaching the confirmation check.
         */
      },
    });

    await writePlan(plan);

    const result = runCli(
      [
        plan.planId,
        '--live',
        `CONFIRM:${plan.planId}:anything:10000000:BASE_1`,
      ],
      {
        LIVE_TRADING: 'true',
        ENABLE_MAINNET_EXECUTION: 'true',
        PRIVATE_KEY_FILE: keyFilePath,
        WALLET_PUBLIC_KEY: keyFileWallet,
      }
    );

    assert.notEqual(
      result.status,
      0
    );

    assert.match(
      result.stderr,
      /no artifact ID/i
    );
  }
);

test(
  'dry-run configuration rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const plan = buildPlanFile();
    await writePlan(plan);

    const result = runCli(
      [
        plan.planId,
        '--live',
        `CONFIRM:${plan.planId}:${ARTIFACT_ID}`,
      ],
      { LIVE_TRADING: 'false' }
    );

    assert.notEqual(
      result.status,
      0
    );

    assert.match(
      result.stderr,
      /LIVE_TRADING=true is required/i
    );
  }
);

test(
  'missing signer rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const plan = buildPlanFile();
    await writePlan(plan);

    /*
     * LIVE_TRADING=true but no PRIVATE_KEY / PRIVATE_KEY_FILE.
     * The secure key-loader throws at config-load time before
     * the CLI reaches its own signer check. Either message is
     * an acceptable rejection — both prove the operator cannot
     * proceed without configuring a secure signer.
     */
    const result = runCli(
      [
        plan.planId,
        '--live',
        `CONFIRM:${plan.planId}:${ARTIFACT_ID}`,
      ],
      {
        LIVE_TRADING: 'true',
        PRIVATE_KEY: '',
        PRIVATE_KEY_FILE: '',
        ALLOW_ENV_PRIVATE_KEY: 'false',
      }
    );

    assert.notEqual(
      result.status,
      0
    );

    assert.match(
      result.stderr,
      /PRIVATE_KEY_FILE is required|signer is unavailable/i
    );
  }
);

test(
  'usage rejects when arguments are missing',
  async () => {
    await configureEnvironment();

    const result = runCli([]);

    assert.notEqual(
      result.status,
      0
    );

    assert.match(
      result.stderr,
      /Usage:/i
    );
  }
);

test(
  'non-simulated plan rejects',
  async () => {
    await configureEnvironment();
    await cleanAll();
    await ensureKeyFile();

    const plan = buildPlanFile({
      status: 'prepared',
      walletPublicKey: keyFileWallet,
    });
    await writePlan(plan);

    const result = runCli(
      [
        plan.planId,
        '--live',
        `CONFIRM:${plan.planId}:${ARTIFACT_ID}:10000000:BASE_1`,
      ],
      {
        LIVE_TRADING: 'true',
        ENABLE_MAINNET_EXECUTION: 'true',
        PRIVATE_KEY_FILE: keyFilePath,
        WALLET_PUBLIC_KEY: keyFileWallet,
      }
    );

    assert.notEqual(
      result.status,
      0
    );

    assert.match(
      result.stderr,
      /Plan is not simulated/i
    );
  }
);
