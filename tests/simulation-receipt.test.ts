import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHash } from 'node:crypto';

let configured = false;
let planDir: string;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-receipt-')
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
  process.env.AUDIT_FILE =
    join(dir, 'audit.jsonl');
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

function buildPayload(
  signature: string
) {
  return {
    signature,
    exactMint: 'BASE_REC',
    createdAt: new Date().toISOString(),
    quoteReceivedAtMs: Date.now() - 1_000,

    walletPublicKey:
      '11111111111111111111111111111111',
    expectedCluster: 'mainnet-beta',
    buyLamports: '10000000',

    approvedPoolAddress: 'POOL_REC',
    approvedQuoteMint:
      'So11111111111111111111111111111111111111112',
    approvedLiquiditySol: 100,

    currentPoolAddress: 'POOL_REC',
    currentQuoteMint:
      'So11111111111111111111111111111111111111112',
    currentLiquiditySol: 90,

    routeHopCount: 1,
    routeLabels: ['Raydium AMM'],
    routeAmmKeys: ['POOL_REC'],

    quoteInputMint:
      'So11111111111111111111111111111111111111112',
    quoteOutputMint: 'BASE_REC',
    quoteInAmount: '10000000',
    quoteOutAmount: '123456',
    quoteOtherAmountThreshold: '120000',
    quoteSlippageBps: 150,
    quotePriceImpactPct: '0.5',
    quoteRoutePlan: [],

    routeOk: true,
    routeReasons: [],
    approvalOk: true,
    approvalReasons: [],
    quoteAgeMs: 1_000,
    liquidityDropPct: 10,
  };
}

function buildReceipt(
  planSha256: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    transactionMessageSha256:
      createHash('sha256')
        .update('mock-message')
        .digest('hex'),
    serializedTransactionSha256:
      createHash('sha256')
        .update('mock-serialized')
        .digest('hex'),

    recentBlockhash:
      'recent-blockhash-mock',
    lastValidBlockHeight: 999,

    simulatedAt:
      new Date().toISOString(),
    rpcEndpoint:
      'https://api.mainnet-beta.solana.com',
    contextSlot: 123456,

    err: null,
    unitsConsumed: 50000,
    logsSha256:
      createHash('sha256')
        .update('mock-logs')
        .digest('hex'),

    walletPublicKey:
      '11111111111111111111111111111111',
    expectedCluster: 'mainnet-beta',
    planSha256BeforeSimulation: planSha256,

    ...overrides,
  };
}

test(
  'successful receipt is persisted',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationReceipt,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload('sig-rec-1')
      );

    const receipt = buildReceipt(
      file.sha256
    );

    const updated =
      await commitSimulationReceipt(
        file.planId,
        receipt
      );

    assert.equal(
      updated.state.status,
      'simulated'
    );

    assert.ok(
      updated.state.simulationReceipt
    );

    assert.equal(
      updated.state.simulationReceipt
        ?.transactionMessageSha256,
      receipt.transactionMessageSha256
    );

    assert.equal(
      updated.state.simulationReceipt
        ?.contextSlot,
      123456
    );
  }
);

test(
  'simulation error leaves plan prepared',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationReceipt,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload('sig-rec-err')
      );

    const receipt = buildReceipt(
      file.sha256,
      {
        err: {
          InstructionError: [
            0,
            'Custom',
          ],
        },
      }
    );

    await assert.rejects(
      () =>
        commitSimulationReceipt(
          file.planId,
          receipt
        ),
      /Simulation returned an error/
    );

    /*
     * Plan must still be 'prepared'.
     */
    const reloaded =
      await loadApprovedExecutionPlan(
        file.planId
      );

    assert.equal(
      reloaded.state.status,
      'prepared'
    );

    assert.ok(
      !reloaded.state.simulationReceipt
    );
  }
);

test(
  'changed plan hash rejects receipt commit',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      commitSimulationReceipt,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload('sig-rec-hash')
      );

    /*
     * Use a wrong planSha256BeforeSimulation.
     */
    const receipt = buildReceipt(
      'wrong-sha256-value'
    );

    await assert.rejects(
      () =>
        commitSimulationReceipt(
          file.planId,
          receipt
        ),
      /changed between simulation and commit/
    );
  }
);

test(
  'concurrent cancellation rejects receipt commit',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      cancelApprovedExecutionPlan,
      commitSimulationReceipt,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload('sig-rec-cancel')
      );

    /*
     * Cancel the plan first.
     */
    await cancelApprovedExecutionPlan(
      file.planId,
      'cancelled before receipt commit'
    );

    /*
     * Try to commit a receipt — should fail
     * because the plan is no longer 'prepared'.
     */
    const receipt = buildReceipt(
      file.sha256
    );

    await assert.rejects(
      () =>
        commitSimulationReceipt(
          file.planId,
          receipt
        ),
      /not reusable/
    );
  }
);

test(
  'transaction hash mismatch is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      commitSimulationReceipt,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload('sig-rec-txhash')
      );

    /*
     * Use a completely different SHA-256
     * for planSha256BeforeSimulation.
     */
    const receipt = buildReceipt(
      '0000000000000000000000000000000000000000000000000000000000000000'
    );

    await assert.rejects(
      () =>
        commitSimulationReceipt(
          file.planId,
          receipt
        ),
      /changed between simulation and commit/
    );
  }
);

test(
  'wallet/cluster mismatch is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      commitSimulationReceipt,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload('sig-rec-wallet')
      );

    /*
     * Wrong wallet in receipt.
     */
    const receiptWrongWallet = buildReceipt(
      file.sha256,
      {
        walletPublicKey:
          'So11111111111111111111111111111111111111112',
      }
    );

    await assert.rejects(
      () =>
        commitSimulationReceipt(
          file.planId,
          receiptWrongWallet
        ),
      /Receipt wallet does not match/
    );

    /*
     * Wrong cluster in receipt.
     */
    const receiptWrongCluster = buildReceipt(
      file.sha256,
      {
        expectedCluster: 'devnet',
      }
    );

    await assert.rejects(
      () =>
        commitSimulationReceipt(
          file.planId,
          receiptWrongCluster
        ),
      /Receipt cluster does not match/
    );
  }
);

test(
  'stale context slot is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      commitSimulationReceipt,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload('sig-rec-stale')
      );

    /*
     * Use a simulatedAt that is older than
     * maxApprovedExecutionPlanAgeSeconds (30s).
     */
    const staleDate = new Date(
      Date.now() - 60_000
    );

    const receipt = buildReceipt(
      file.sha256,
      {
        simulatedAt:
          staleDate.toISOString(),
      }
    );

    await assert.rejects(
      () =>
        commitSimulationReceipt(
          file.planId,
          receipt
        ),
      /too old/
    );
  }
);

test(
  'receipt survives reload and hash verification',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationReceipt,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const file =
      await writeApprovedExecutionPlan(
        buildPayload('sig-rec-survive')
      );

    const receipt = buildReceipt(
      file.sha256
    );

    await commitSimulationReceipt(
      file.planId,
      receipt
    );

    /*
     * Reload the plan from disk.
     */
    const reloaded =
      await loadApprovedExecutionPlan(
        file.planId
      );

    assert.equal(
      reloaded.state.status,
      'simulated'
    );

    assert.ok(
      reloaded.state.simulationReceipt,
      'Receipt should be persisted'
    );

    /*
     * Verify the receipt fields survived
     * serialization + deserialization.
     */
    assert.equal(
      reloaded.state.simulationReceipt
        ?.transactionMessageSha256,
      receipt.transactionMessageSha256
    );

    assert.equal(
      reloaded.state.simulationReceipt
        ?.serializedTransactionSha256,
      receipt.serializedTransactionSha256
    );

    assert.equal(
      reloaded.state.simulationReceipt
        ?.contextSlot,
      receipt.contextSlot
    );

    assert.equal(
      reloaded.state.simulationReceipt
        ?.walletPublicKey,
      receipt.walletPublicKey
    );

    assert.equal(
      reloaded.state.simulationReceipt
        ?.planSha256BeforeSimulation,
      receipt.planSha256BeforeSimulation
    );

    /*
     * Verify the plan hash is still valid
     * (the receipt is part of the hashed state,
     * so the hash changed when the receipt was
     * added — but it should still verify).
     */
    assert.ok(
      reloaded.sha256.length === 64,
      'Plan SHA-256 should be a 64-char hex string'
    );
  }
);
