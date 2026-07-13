import assert from 'node:assert/strict';
import test from 'node:test';

import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;
let planDir: string;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-ledger-')
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
  process.env.FILE_LOCK_TIMEOUT_MS =
    '5000';
  process.env.FILE_LOCK_RETRY_MS =
    '10';

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
    exactMint: 'BASE_LED',
    createdAt: new Date().toISOString(),
    quoteReceivedAtMs: Date.now() - 1_000,

    walletPublicKey:
      '11111111111111111111111111111111',
    expectedCluster: 'mainnet-beta',
    buyLamports: '10000000',

    approvedPoolAddress: 'POOL_LED',
    approvedQuoteMint:
      'So11111111111111111111111111111111111111112',
    approvedLiquiditySol: 100,

    currentPoolAddress: 'POOL_LED',
    currentQuoteMint:
      'So11111111111111111111111111111111111111112',
    currentLiquiditySol: 90,

    routeHopCount: 1,
    routeLabels: ['Raydium AMM'],
    routeAmmKeys: ['POOL_LED'],

    quoteInputMint:
      'So11111111111111111111111111111111111111112',
    quoteOutputMint: 'BASE_LED',
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

async function createAndDeletePlan(
  signature: string
): Promise<string> {
  const {
    writeApprovedExecutionPlan,
    deleteApprovedExecutionPlan,
  } = await import(
    '../sniper/execution-plan.js'
  );

  const file =
    await writeApprovedExecutionPlan(
      buildPayload(signature)
    );

  await deleteApprovedExecutionPlan(
    file.planId,
    { reason: `test:${signature}` }
  );

  return file.planId;
}

test(
  'valid ledger verifies',
  async () => {
    await configureEnvironment();
    await cleanAll();

    await createAndDeletePlan('sig-led-1');
    await createAndDeletePlan('sig-led-2');
    await createAndDeletePlan('sig-led-3');

    const { verifyPlanRetentionLedger } =
      await import(
        '../sniper/plan-audit.js'
      );

    const result =
      await verifyPlanRetentionLedger();

    assert.equal(result.ok, true);
    assert.equal(result.entryCount, 3);
    assert.deepEqual(result.errors, []);
  }
);

test(
  'edited entry fails',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const planId =
      await createAndDeletePlan(
        'sig-edit-1'
      );

    const { verifyPlanRetentionLedger } =
      await import(
        '../sniper/plan-audit.js'
      );

    /*
     * Edit the tombstone file to change a field
     * without updating the entryHash.
     */
    const { readPlanTombstones } =
      await import(
        '../sniper/plan-audit.js'
      );

    const tombstones =
      await readPlanTombstones();

    const tombstonePath = join(
      planDir,
      'tombstones',
      `${tombstones[0].deletionId}.json`
    );

    const content = JSON.parse(
      await readFile(tombstonePath, 'utf8')
    );

    content.deleteReason =
      'tampered-reason';

    await writeFile(
      tombstonePath,
      JSON.stringify(content, null, 2),
      { mode: 0o600 }
    );

    const result =
      await verifyPlanRetentionLedger();

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes('entryHash mismatch')
      )
    );
  }
);

test(
  'deleted middle entry fails',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const planId1 =
      await createAndDeletePlan(
        'sig-mid-1'
      );

    const planId2 =
      await createAndDeletePlan(
        'sig-mid-2'
      );

    await createAndDeletePlan('sig-mid-3');

    /*
     * Delete the middle tombstone file.
     */
    const { readPlanTombstones } =
      await import(
        '../sniper/plan-audit.js'
      );

    const tombstones =
      await readPlanTombstones();

    /*
     * Find the tombstone for planId2.
     */
    const midTombstone =
      tombstones.find(
        (t) => t.planId === planId2
      );

    assert.ok(midTombstone);

    const tombstonePath = join(
      planDir,
      'tombstones',
      `${midTombstone.deletionId}.json`
    );

    await rm(tombstonePath, {
      force: true,
    });

    const { verifyPlanRetentionLedger } =
      await import(
        '../sniper/plan-audit.js'
      );

    const result =
      await verifyPlanRetentionLedger();

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes('sequence gap')
      )
    );

    void planId1;
  }
);

test(
  'reordered entries fail',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const planId1 =
      await createAndDeletePlan(
        'sig-reord-1'
      );

    const planId2 =
      await createAndDeletePlan(
        'sig-reord-2'
      );

    /*
     * Swap the sequence numbers of the two
     * tombstone files.
     */
    const { readPlanTombstones } =
      await import(
        '../sniper/plan-audit.js'
      );

    const tombstones =
      await readPlanTombstones();

    const t1 = tombstones.find(
      (t) => t.planId === planId1
    );
    const t2 = tombstones.find(
      (t) => t.planId === planId2
    );

    assert.ok(t1);
    assert.ok(t2);

    const tombstoneDir = join(
      planDir,
      'tombstones'
    );

    const path1 = join(
      tombstoneDir,
      `${t1.deletionId}.json`
    );

    const path2 = join(
      tombstoneDir,
      `${t2.deletionId}.json`
    );

    const content1 = JSON.parse(
      await readFile(path1, 'utf8')
    );

    const content2 = JSON.parse(
      await readFile(path2, 'utf8')
    );

    /*
     * Swap sequence and previousHash.
     */
    const seq1 = content1.sequence;
    const prev1 = content1.previousHash;

    content1.sequence = content2.sequence;
    content1.previousHash = content2.previousHash;

    content2.sequence = seq1;
    content2.previousHash = prev1;

    await writeFile(
      path1,
      JSON.stringify(content1, null, 2),
      { mode: 0o600 }
    );

    await writeFile(
      path2,
      JSON.stringify(content2, null, 2),
      { mode: 0o600 }
    );

    const { verifyPlanRetentionLedger } =
      await import(
        '../sniper/plan-audit.js'
      );

    const result =
      await verifyPlanRetentionLedger();

    assert.equal(result.ok, false);
  }
);

test(
  'concurrent appends preserve sequence',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Launch 5 concurrent create+delete operations.
     * The ledger lock should serialize tombstone
     * writes so each gets a unique sequence number.
     */
    const planIds = await Promise.all([
      createAndDeletePlan('sig-conc-1'),
      createAndDeletePlan('sig-conc-2'),
      createAndDeletePlan('sig-conc-3'),
      createAndDeletePlan('sig-conc-4'),
      createAndDeletePlan('sig-conc-5'),
    ]);

    const { readPlanTombstones, verifyPlanRetentionLedger } =
      await import(
        '../sniper/plan-audit.js'
      );

    const tombstones =
      await readPlanTombstones();

    assert.equal(
      tombstones.length,
      5,
      'Should have 5 tombstones'
    );

    /*
     * Verify sequence numbers are 1-5 with no gaps
     * or duplicates.
     */
    const sequences = tombstones
      .map((t) => t.sequence)
      .sort((a, b) => a - b);

    assert.deepEqual(
      sequences,
      [1, 2, 3, 4, 5]
    );

    /*
     * The hash chain should be valid.
     */
    const verification =
      await verifyPlanRetentionLedger();

    assert.equal(verification.ok, true);

    void planIds;
  }
);

test(
  'truncated tombstone file is reported',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const planId =
      await createAndDeletePlan(
        'sig-trunc-1'
      );

    await createAndDeletePlan('sig-trunc-2');

    /*
     * Truncate the first tombstone file so its
     * JSON is incomplete.
     */
    const { readPlanTombstones } =
      await import(
        '../sniper/plan-audit.js'
      );

    const tombstones =
      await readPlanTombstones();

    const target = tombstones.find(
      (t) => t.planId === planId
    );

    assert.ok(target);

    const tombstonePath = join(
      planDir,
      'tombstones',
      `${target.deletionId}.json`
    );

    const content =
      await readFile(tombstonePath, 'utf8');

    await writeFile(
      tombstonePath,
      content.slice(0, 20),
      { mode: 0o600 }
    );

    const { verifyPlanRetentionLedger } =
      await import(
        '../sniper/plan-audit.js'
      );

    const result =
      await verifyPlanRetentionLedger();

    /*
     * The truncated file can't be parsed, so it's
     * skipped by readPlanTombstones. This creates
     * a sequence gap (entry 1 is missing, entry 2
     * becomes entry[0] with sequence=2).
     */
    assert.equal(result.ok, false);
    assert.ok(
      result.errors.length > 0,
      'Should report errors for truncated tombstone'
    );
  }
);

test(
  'doctor reports unhealthy history',
  async () => {
    await configureEnvironment();
    await cleanAll();

    /*
     * Create a valid tombstone, then corrupt it.
     */
    const planId =
      await createAndDeletePlan(
        'sig-doc-1'
      );

    const { readPlanTombstones } =
      await import(
        '../sniper/plan-audit.js'
      );

    const tombstones =
      await readPlanTombstones();

    const target = tombstones.find(
      (t) => t.planId === planId
    );

    assert.ok(target);

    const tombstonePath = join(
      planDir,
      'tombstones',
      `${target.deletionId}.json`
    );

    const content = JSON.parse(
      await readFile(tombstonePath, 'utf8')
    );

    content.finalStatus = 'tampered';

    await writeFile(
      tombstonePath,
      JSON.stringify(content, null, 2),
      { mode: 0o600 }
    );

    /*
     * Call verifyPlanRetentionLedger directly —
     * this is what the doctor CLI uses internally.
     */
    const { verifyPlanRetentionLedger } =
      await import(
        '../sniper/plan-audit.js'
      );

    const result =
      await verifyPlanRetentionLedger();

    assert.equal(result.ok, false);
    assert.ok(
      result.errors.some((e) =>
        e.includes('entryHash mismatch')
      ),
      'Doctor should detect hash mismatch in retention ledger'
    );
  }
);
