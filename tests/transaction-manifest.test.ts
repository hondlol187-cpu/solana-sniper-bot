import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  rm,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  VersionedTransaction,
  MessageV0,
  PublicKey,
  TransactionInstruction,
  AddressLookupTableAccount,
} from '@solana/web3.js';

import type {
  SimulationArtifactRpc,
} from '../sniper/simulation-artifact-rpc.js';

let configured = false;
let planDir: string;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-manifest-')
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
  process.env.MAX_SIMULATION_RECEIPT_AGE_SECONDS =
    '15';
  process.env.MAX_SIMULATION_SLOT_LAG =
    '32';

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
const TOKEN_MINT =
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const RECENT_BLOCKHASH =
  '9WzDXwBbmkg8ZTbNMqJxHBWu3jJ4a8m8mC7qPvR6e8Qx';

const SYSTEM_PROGRAM =
  '11111111111111111111111111111111';
const TOKEN_PROGRAM =
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const COMPUTE_BUDGET_PROGRAM =
  'ComputeBudget111111111111111111111111111111';
const STAKE_PROGRAM =
  'Stake11111111111111111111111111111111111111';

function buildPayload(
  overrides: Record<string, unknown> = {}
) {
  return {
    signature: 'sig-manifest-1',
    exactMint: TOKEN_MINT,
    createdAt: new Date().toISOString(),
    quoteReceivedAtMs: Date.now() - 1_000,

    walletPublicKey: WALLET,
    expectedCluster: 'mainnet-beta',
    buyLamports: '10000000',

    approvedPoolAddress: POOL,
    approvedQuoteMint:
      'So11111111111111111111111111111111111111112',
    approvedLiquiditySol: 100,

    currentPoolAddress: POOL,
    currentQuoteMint:
      'So11111111111111111111111111111111111111112',
    currentLiquiditySol: 90,

    routeHopCount: 1,
    routeLabels: ['Raydium AMM'],
    routeAmmKeys: [POOL],

    quoteInputMint:
      'So11111111111111111111111111111111111111112',
    quoteOutputMint: TOKEN_MINT,
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

    ...overrides,
  };
}

function buildTransaction(
  options: {
    feePayer?: PublicKey;
    extraSigner?: PublicKey;
    poolKey?: PublicKey;
    extraProgram?: PublicKey;
    extraWritableAccount?: PublicKey;
    skipPoolInInstruction?: boolean;
  } = {}
): Buffer {
  const feePayer =
    options.feePayer ?? new PublicKey(WALLET);
  const poolKey =
    options.poolKey ?? new PublicKey(POOL);

  const instructionKeys: Array<{
    pubkey: PublicKey;
    isSigner: boolean;
    isWritable: boolean;
  }> = [
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
  ];

  if (options.extraSigner) {
    instructionKeys.push({
      pubkey: options.extraSigner,
      isSigner: true,
      isWritable: false,
    });
  }

  if (options.extraWritableAccount) {
    instructionKeys.push({
      pubkey: options.extraWritableAccount,
      isSigner: false,
      isWritable: true,
    });
  }

  /*
   * Build a valid SetComputeUnitLimit instruction
   * (discriminator 2, 4 bytes LE) so the
   * compute-budget policy passes.
   */
  const cuLimitData = Buffer.alloc(5);
  cuLimitData[0] = 2;
  cuLimitData.writeUInt32LE(100_000, 1);

  const instructions: TransactionInstruction[] =
    [
      new TransactionInstruction({
        keys: instructionKeys,
        programId: new PublicKey(
          COMPUTE_BUDGET_PROGRAM
        ),
        data: cuLimitData,
      }),
    ];

  if (options.extraProgram) {
    instructions.push(
      new TransactionInstruction({
        keys: [
          {
            pubkey: feePayer,
            isSigner: false,
            isWritable: false,
          },
        ],
        programId: options.extraProgram,
        data: Buffer.alloc(0),
      })
    );
  }

  /*
   * If we want to test a pool key that's in
   * the account list but NOT in any instruction,
   * we add it as an extra account that's not
   * referenced by any instruction.
   */
  if (options.skipPoolInInstruction) {
    /*
     * Rebuild with the pool NOT in any instruction.
     * The pool is still in the static account keys
     * (because it's the feePayer's alternate),
     * but no instruction references it.
     */
    instructions[0] = new TransactionInstruction({
      keys: [
        {
          pubkey: feePayer,
          isSigner: true,
          isWritable: true,
        },
      ],
      programId: new PublicKey(
        COMPUTE_BUDGET_PROGRAM
      ),
      data: cuLimitData,
    });
  }

  const message = MessageV0.compile({
    payerKey: feePayer,
    instructions,
    recentBlockhash: RECENT_BLOCKHASH,
    addressLookupTableAccounts: [],
  });

  const transaction =
    new VersionedTransaction(message);

  return Buffer.from(transaction.serialize());
}

function createArtifactRpc(
  options: {
    currentSlot?: number;
    currentBlockHeight?: number;
    blockhashValid?: boolean;
    lookupTables?: AddressLookupTableAccount[];
  } = {}
): SimulationArtifactRpc {
  const lookupTables = new Map(
    (options.lookupTables ?? []).map((t) => [
      t.key.toBase58(),
      t,
    ])
  );

  return {
    async getCurrentSlot() {
      return options.currentSlot ?? 123_480;
    },
    async getCurrentBlockHeight() {
      return options.currentBlockHeight ?? 500;
    },
    async isRecentBlockhashValid() {
      return options.blockhashValid ?? true;
    },
    async loadAddressLookupTable(address: PublicKey) {
      return lookupTables.get(address.toBase58()) ?? null;
    },
  };
}

function buildValidArtifactInput(
  planFile: import('../sniper/execution-plan.js').ApprovedExecutionPlanFile,
  overrides: Record<string, unknown> = {}
) {
  return {
    planId: planFile.planId,
    planSha256BeforeSimulation: planFile.sha256,
    serializedTransaction: buildTransaction(),
    simulationResponse: {
      contextSlot: 123_456,
      err: null,
      logs: ['log1', 'log2'],
      unitsConsumed: 50_000,
      returnData: {
        programId: TOKEN_PROGRAM,
        data: ['AQID', 'base64'] as [string, string],
      },
    },
    rpcEndpoint:
      'https://api.mainnet-beta.solana.com',
    simulatedAt: new Date().toISOString(),
    recentBlockhash: RECENT_BLOCKHASH,
    lastValidBlockHeight: 999,
    ...overrides,
  };
}

test(
  'valid expected transaction passes policy',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationArtifact,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    const result =
      await commitSimulationArtifact(
        buildValidArtifactInput(file),
        createArtifactRpc()
      );

    assert.equal(
      result.state.simulationReceipt
        ?.transactionPolicyOk,
      true
    );
    assert.ok(
      result.state.simulationReceipt
        ?.transactionManifestSha256
    );
  }
);

test(
  'expected AMM key present but unused by instruction → reject',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationArtifact,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    await assert.rejects(
      () =>
        commitSimulationArtifact(
          {
            ...buildValidArtifactInput(file),
            serializedTransaction:
              buildTransaction({
                skipPoolInInstruction: true,
              }),
          },
          createArtifactRpc()
        ),
      /not referenced by any invoked instruction|policy/i
    );
  }
);

test(
  'unknown invoked program → reject',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationArtifact,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    const unknownProgram = new PublicKey(
      '9xQeWvG816bUx9EPa9Xr5K6YwJqk1oQZ3nKQjK7QjK7Q'
    );

    await assert.rejects(
      () =>
        commitSimulationArtifact(
          {
            ...buildValidArtifactInput(file),
            serializedTransaction:
              buildTransaction({
                extraProgram: unknownProgram,
              }),
          },
          createArtifactRpc()
        ),
      /Unknown program|policy/i
    );
  }
);

test(
  'forbidden program (stake) → reject',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationArtifact,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    await assert.rejects(
      () =>
        commitSimulationArtifact(
          {
            ...buildValidArtifactInput(file),
            serializedTransaction:
              buildTransaction({
                extraProgram: new PublicKey(
                  STAKE_PROGRAM
                ),
              }),
          },
          createArtifactRpc()
        ),
      /Forbidden program|policy/i
    );
  }
);

test(
  'additional required signer → reject',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationArtifact,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const file =
      await loadApprovedExecutionPlan(
        created.planId
      );

    const extraSigner = new PublicKey(
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
    );

    await assert.rejects(
      () =>
        commitSimulationArtifact(
          {
            ...buildValidArtifactInput(file),
            serializedTransaction:
              buildTransaction({
                extraSigner,
              }),
          },
          createArtifactRpc()
        ),
      /unexpected.*signer|policy/i
    );
  }
);

test(
  'concurrent artifact commits allow exactly one winner',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationArtifact,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const prepared =
      await loadApprovedExecutionPlan(
        created.planId
      );

    const input =
      buildValidArtifactInput(prepared);

    const results =
      await Promise.allSettled([
        commitSimulationArtifact(
          input,
          createArtifactRpc()
        ),
        commitSimulationArtifact(
          input,
          createArtifactRpc()
        ),
      ]);

    const fulfilled = results.filter(
      (r) => r.status === 'fulfilled'
    );
    const rejected = results.filter(
      (r) => r.status === 'rejected'
    );

    assert.equal(
      fulfilled.length,
      1,
      'exactly one artifact commit must succeed'
    );
    assert.equal(
      rejected.length,
      1,
      'exactly one artifact commit must reject'
    );

    const reloaded =
      await loadApprovedExecutionPlan(
        created.planId
      );

    assert.equal(
      reloaded.state.status,
      'simulated'
    );
    assert.equal(
      reloaded.state.simulationCount,
      1
    );
  }
);

test(
  'concurrent cancel/commit allows exactly one winner',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationArtifact,
      cancelApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const prepared =
      await loadApprovedExecutionPlan(
        created.planId
      );

    const input =
      buildValidArtifactInput(prepared);

    const results =
      await Promise.allSettled([
        commitSimulationArtifact(
          input,
          createArtifactRpc()
        ),
        cancelApprovedExecutionPlan(
          created.planId,
          'concurrent cancel'
        ),
      ]);

    const fulfilled = results.filter(
      (r) => r.status === 'fulfilled'
    );

    assert.equal(
      fulfilled.length,
      1,
      'exactly one must succeed'
    );

    const reloaded =
      await loadApprovedExecutionPlan(
        created.planId
      );

    assert.ok(
      reloaded.state.status === 'simulated' ||
        reloaded.state.status === 'cancelled'
    );
  }
);

test(
  'changed plan SHA during verification rejects commit',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationArtifact,
      cancelApprovedExecutionPlan,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const prepared =
      await loadApprovedExecutionPlan(
        created.planId
      );

    /*
     * Cancel the plan to change its SHA
     * before committing the artifact.
     */
    await cancelApprovedExecutionPlan(
      created.planId,
      'sha change'
    );

    await assert.rejects(
      () =>
        commitSimulationArtifact(
          buildValidArtifactInput(prepared),
          createArtifactRpc()
        ),
      /not reusable|changed|status/i
    );
  }
);

test(
  'same artifact cannot be replayed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationArtifact,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const prepared =
      await loadApprovedExecutionPlan(
        created.planId
      );

    const input =
      buildValidArtifactInput(prepared);

    await commitSimulationArtifact(
      input,
      createArtifactRpc()
    );

    /*
     * Second commit with the same input
     * must fail because the plan is no
     * longer 'prepared'.
     */
    await assert.rejects(
      () =>
        commitSimulationArtifact(
          input,
          createArtifactRpc()
        ),
      /not reusable|status|changed/i
    );
  }
);

test(
  'failed policy check leaves status prepared',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationArtifact,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const unknownProgram = new PublicKey(
      '9xQeWvG816bUx9EPa9Xr5K6YwJqk1oQZ3nKQjK7QjK7Q'
    );

    const prepared =
      await loadApprovedExecutionPlan(
        created.planId
      );

    await assert.rejects(
      () =>
        commitSimulationArtifact(
          {
            ...buildValidArtifactInput(
              prepared
            ),
            serializedTransaction:
              buildTransaction({
                extraProgram: unknownProgram,
              }),
          },
          createArtifactRpc()
        ),
      /policy/i
    );

    const reloaded =
      await loadApprovedExecutionPlan(
        created.planId
      );

    assert.equal(
      reloaded.state.status,
      'prepared',
      'Plan must remain prepared after failed policy check'
    );
  }
);

test(
  'manifest hash changes when instruction data changes',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      buildTransactionManifest,
    } = await import(
      '../sniper/transaction-manifest.js'
    );

    const {
      VersionedTransaction,
      MessageV0,
      PublicKey,
      TransactionInstruction,
    } = await import('@solana/web3.js');

    const feePayer = new PublicKey(WALLET);
    const poolKey = new PublicKey(POOL);

    /*
     * Build two transactions with different
     * instruction data.
     */
    const msg1 = MessageV0.compile({
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
          data: Buffer.from([1]),
        }),
      ],
      recentBlockhash: RECENT_BLOCKHASH,
      addressLookupTableAccounts: [],
    });

    const msg2 = MessageV0.compile({
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
          data: Buffer.from([2]),
        }),
      ],
      recentBlockhash: RECENT_BLOCKHASH,
      addressLookupTableAccounts: [],
    });

    const tx1 = new VersionedTransaction(msg1);
    const tx2 = new VersionedTransaction(msg2);

    const rpc = createArtifactRpc();

    const manifest1 =
      await buildTransactionManifest(tx1, rpc);
    const manifest2 =
      await buildTransactionManifest(tx2, rpc);

    assert.notEqual(
      manifest1.manifestSha256,
      manifest2.manifestSha256,
      'Manifest hash must differ when instruction data differs'
    );
  }
);

test(
  'instruction-data evidence is order-sensitive',
  async () => {
    await configureEnvironment();

    const {
      buildTransactionManifest,
      computeInstructionDataSha256,
    } = await import(
      '../sniper/transaction-manifest.js'
    );

    const {
      VersionedTransaction,
      MessageV0,
      PublicKey,
      TransactionInstruction,
    } = await import('@solana/web3.js');

    const payer =
      new PublicKey(WALLET);

    const pool =
      new PublicKey(POOL);

    const first =
      new TransactionInstruction({
        keys: [
          {
            pubkey: payer,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: pool,
            isSigner: false,
            isWritable: true,
          },
        ],
        programId:
          new PublicKey(
            COMPUTE_BUDGET_PROGRAM
          ),
        data:
          Buffer.from([
            2,
            64,
            66,
            15,
            0,
          ]),
      });

    const second =
      new TransactionInstruction({
        keys: [
          {
            pubkey: payer,
            isSigner: true,
            isWritable: true,
          },
        ],
        programId:
          new PublicKey(
            COMPUTE_BUDGET_PROGRAM
          ),
        data:
          Buffer.from([
            3,
            1,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
          ]),
      });

    function build(
      instructions:
        TransactionInstruction[]
    ) {
      return new VersionedTransaction(
        MessageV0.compile({
          payerKey: payer,
          instructions,
          recentBlockhash:
            RECENT_BLOCKHASH,
          addressLookupTableAccounts:
            [],
        })
      );
    }

    const firstOrder =
      await buildTransactionManifest(
        build([
          first,
          second,
        ]),
        createArtifactRpc()
      );

    const secondOrder =
      await buildTransactionManifest(
        build([
          second,
          first,
        ]),
        createArtifactRpc()
      );

    assert.notEqual(
      computeInstructionDataSha256(
        firstOrder
      ),
      computeInstructionDataSha256(
        secondOrder
      )
    );
  }
);

test(
  'forbidden token approve instruction is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationArtifact,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload()
      );

    const prepared =
      await loadApprovedExecutionPlan(
        created.planId
      );

    const payer =
      new PublicKey(WALLET);

    const pool =
      new PublicKey(POOL);

    const approveInstruction =
      new TransactionInstruction({
        keys: [
          {
            pubkey: payer,
            isSigner: true,
            isWritable: true,
          },
          {
            pubkey: pool,
            isSigner: false,
            isWritable: true,
          },
        ],
        programId:
          new PublicKey(
            TOKEN_PROGRAM
          ),

        /*
         * SPL Token Approve discriminator.
         */
        data:
          Buffer.from([
            4,
            1,
            0,
            0,
            0,
            0,
            0,
            0,
            0,
          ]),
      });

    const transaction =
      new VersionedTransaction(
        MessageV0.compile({
          payerKey: payer,
          instructions: [
            approveInstruction,
          ],
          recentBlockhash:
            RECENT_BLOCKHASH,
          addressLookupTableAccounts:
            [],
        })
      );

    await assert.rejects(
      commitSimulationArtifact(
        {
          ...buildValidArtifactInput(
            prepared
          ),
          serializedTransaction:
            Buffer.from(
              transaction.serialize()
            ),
        },
        createArtifactRpc()
      ),
      /Forbidden token instruction Approve|policy/i
    );

    const reloaded =
      await loadApprovedExecutionPlan(
        created.planId
      );

    assert.equal(
      reloaded.state.status,
      'prepared'
    );
  }
);

test(
  'excessive compute-unit limit is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      writeApprovedExecutionPlan,
      loadApprovedExecutionPlan,
      commitSimulationArtifact,
    } = await import(
      '../sniper/execution-plan.js'
    );

    const created =
      await writeApprovedExecutionPlan(
        buildPayload({
          transactionPolicy: {
            allowedProgramIds: [
              COMPUTE_BUDGET_PROGRAM,
            ],
            requiredRouteAccounts: [
              POOL,
            ],
            allowedWritableAccounts: [
              WALLET,
              POOL,
            ],
            walletTokenAccounts: [],
            expectedInputMint:
              'So11111111111111111111111111111111111111112',
            expectedOutputMint:
              TOKEN_MINT,
            maximumComputeUnitLimit:
              200_000,
            maximumComputeUnitPriceMicroLamports:
              1_000_000,
          },
        })
      );

    const prepared =
      await loadApprovedExecutionPlan(
        created.planId
      );

    const payer =
      new PublicKey(WALLET);

    const pool =
      new PublicKey(POOL);

    const data =
      Buffer.alloc(5);

    data[0] = 2;
    data.writeUInt32LE(
      300_000,
      1
    );

    const transaction =
      new VersionedTransaction(
        MessageV0.compile({
          payerKey: payer,
          instructions: [
            new TransactionInstruction({
              keys: [
                {
                  pubkey: payer,
                  isSigner: true,
                  isWritable: true,
                },
                {
                  pubkey: pool,
                  isSigner: false,
                  isWritable: true,
                },
              ],
              programId:
                new PublicKey(
                  COMPUTE_BUDGET_PROGRAM
                ),
              data,
            }),
          ],
          recentBlockhash:
            RECENT_BLOCKHASH,
          addressLookupTableAccounts:
            [],
        })
      );

    await assert.rejects(
      commitSimulationArtifact(
        {
          ...buildValidArtifactInput(
            prepared
          ),
          serializedTransaction:
            Buffer.from(
              transaction.serialize()
            ),
        },
        createArtifactRpc()
      ),
      /Compute unit limit.*exceeds approved maximum|policy/i
    );
  }
);
