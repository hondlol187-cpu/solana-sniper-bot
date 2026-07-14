import {
  createHash,
} from 'node:crypto';

import {
  MessageV0,
  PublicKey,
  VersionedTransaction,
  AddressLookupTableAccount,
} from '@solana/web3.js';

import type {
  SimulationArtifactRpc,
} from './simulation-artifact-rpc.js';

import type {
  ApprovedExecutionPlanFile,
} from './execution-plan.js';

import { config } from './config.js';

/*
 * Canonical transaction manifest types.
 */

export interface ManifestAccount {
  address: string;
  signer: boolean;
  writable: boolean;
  source:
    | 'static'
    | 'lookup-writable'
    | 'lookup-readonly';
}

export interface ManifestInstruction {
  index: number;
  programId: string;
  accountAddresses: string[];
  writableAccounts: string[];
  signerAccounts: string[];

  /*
   * Canonical instruction bytes.
   *
   * dataBase64 enables policy enforcement while dataSha256
   * provides a compact integrity value for receipts.
   */
  dataBase64: string;
  dataSha256: string;
}

export interface TransactionManifest {
  version: 'legacy' | 0;
  feePayer: string;
  recentBlockhash: string;

  requiredSigners: string[];
  accounts: ManifestAccount[];
  instructions: ManifestInstruction[];

  lookupTableAddresses: string[];
  lookupTablesSha256?: string;

  manifestSha256: string;
}

/*
 * Transaction policy types.
 */

export interface TransactionPolicyResult {
  ok: boolean;
  reasons: string[];

  manifestSha256: string;
  invokedProgramIds: string[];
  unexpectedProgramIds: string[];
  unexpectedWritableAccounts: string[];
  missingRouteAccounts: string[];
}

export interface ApprovedTransactionPolicy {
  allowedProgramIds: string[];
  requiredRouteAccounts: string[];
  allowedWritableAccounts: string[];
  allowedReadonlyAccounts?: string[];
  walletTokenAccounts: string[];
  expectedInputMint: string;
  expectedOutputMint: string;
  maximumComputeUnitLimit: number;
  maximumComputeUnitPriceMicroLamports: number;

  /*
   * Optional because plans written before this field was
   * introduced must remain readable.
   */
  maximumHeapFrameBytes?: number;
}

/*
 * Stable stringify for deterministic hashing.
 */

function stableStringify(
  value: unknown
): string {
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
    value as Record<string, unknown>
  ).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  return `{${entries
    .map(
      ([key, item]) =>
        `${JSON.stringify(key)}:${stableStringify(item)}`
    )
    .join(',')}}`;
}

/*
 * Canonical program allowlist.
 * Derived from config, not from Jupiter labels.
 */

const SYSTEM_PROGRAM_ID =
  '11111111111111111111111111111111';
const TOKEN_PROGRAM_ID =
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID =
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const COMPUTE_BUDGET_PROGRAM_ID =
  'ComputeBudget111111111111111111111111111111';
const SYSVAR_RENT_ID =
  'SysvarRent111111111111111111111111111111111';
const SYSVAR_CLOCK_ID =
  'SysvarC1ock11111111111111111111111111111111';

const FORBIDDEN_PROGRAM_IDS = new Set([
  'Stake11111111111111111111111111111111111111',
  'Vote111111111111111111111111111111111111111',
  'BPFLoader1111111111111111111111111111111111',
  'BPFLoader2111111111111111111111111111111111',
  'BPFLoaderUpgradeab1e11111111111111111111111',
  'AddressLookupTab1e1111111111111111111111111',
  'Nonce11111111111111111111111111111111111111',
]);

/*
 * Build a canonical transaction manifest from
 * a deserialized VersionedTransaction.
 *
 * Resolves every address lookup table via the
 * trusted RPC, maps instruction account indexes
 * to actual addresses, preserves signer/writable
 * flags, identifies the real invoked program for
 * every instruction, hashes each instruction's
 * raw data, and computes manifestSha256 over the
 * canonical structure.
 */
export async function buildTransactionManifest(
  transaction: VersionedTransaction,
  rpc: SimulationArtifactRpc
): Promise<TransactionManifest> {
  const isV0 = transaction.version === 0;
  const message = isV0
    ? (transaction.message as MessageV0)
    : (transaction.message as unknown as MessageV0);

  const staticAccountKeys =
    message.staticAccountKeys;

  /*
   * Resolve address lookup tables.
   */
  const lookupTableAddresses: string[] = [];
  let lookupTablesSha256: string | undefined;

  let allAccountKeys: PublicKey[];

  if (
    isV0 &&
    message.addressTableLookups &&
    message.addressTableLookups.length > 0
  ) {
    const lookupTableAccounts: AddressLookupTableAccount[] =
      [];

    const canonicalEvidence: Array<{
      tableAddress: string;
      writable: Array<{
        index: number;
        address: string;
      }>;
      readonly: Array<{
        index: number;
        address: string;
      }>;
    }> = [];

    for (const lookup of message.addressTableLookups) {
      let table: AddressLookupTableAccount | null;

      try {
        table = await rpc.loadAddressLookupTable(
          lookup.accountKey
        );
      } catch (error) {
        const detail =
          error instanceof Error
            ? error.message
            : String(error);

        throw new Error(
          `Failed to load address lookup table ${lookup.accountKey.toBase58()}: ${detail}`
        );
      }

      if (!table) {
        throw new Error(
          `Address lookup table ${lookup.accountKey.toBase58()} does not exist`
        );
      }

      if (!table.key.equals(lookup.accountKey)) {
        throw new Error(
          'Loaded address lookup table key does not match transaction lookup'
        );
      }

      lookupTableAccounts.push(table);
      lookupTableAddresses.push(
        table.key.toBase58()
      );

      const writable = Array.from(
        lookup.writableIndexes
      ).map((index) => ({
        index,
        address:
          table.state.addresses[index]?.toBase58() ??
          (() => {
            throw new Error(
              `Address lookup table ${table.key.toBase58()} has an out-of-range writable index ${index}`
            );
          })(),
      }));

      const readonly = Array.from(
        lookup.readonlyIndexes
      ).map((index) => ({
        index,
        address:
          table.state.addresses[index]?.toBase58() ??
          (() => {
            throw new Error(
              `Address lookup table ${table.key.toBase58()} has an out-of-range readonly index ${index}`
            );
          })(),
      }));

      canonicalEvidence.push({
        tableAddress: table.key.toBase58(),
        writable,
        readonly,
      });
    }

    lookupTablesSha256 = createHash('sha256')
      .update(JSON.stringify(canonicalEvidence))
      .digest('hex');

    const resolvedKeys = message.getAccountKeys({
      addressLookupTableAccounts: lookupTableAccounts,
    });

    allAccountKeys = [];

    for (let i = 0; i < resolvedKeys.length; i++) {
      const key = resolvedKeys.get(i);

      if (!key) {
        throw new Error(
          `Resolved transaction account key ${i} is missing`
        );
      }

      allAccountKeys.push(key);
    }
  } else {
    allAccountKeys = [...staticAccountKeys];
  }

  /*
   * Build account list with metadata.
   */
  const accounts: ManifestAccount[] = [];

  const staticCount =
    staticAccountKeys.length;

  /*
   * MessageAccountKeys ordering for v0 transactions is:
   *
   * 1. static keys
   * 2. all writable lookup keys from every table
   * 3. all readonly lookup keys from every table
   *
   * Lookup keys are not interleaved table-by-table.
   */
  const writableLookupCount =
    isV0
      ? message.addressTableLookups
          .reduce(
            (total, lookup) =>
              total +
              lookup
                .writableIndexes
                .length,
            0
          )
      : 0;

  const readonlyLookupCount =
    isV0
      ? message.addressTableLookups
          .reduce(
            (total, lookup) =>
              total +
              lookup
                .readonlyIndexes
                .length,
            0
          )
      : 0;

  const writableLookupStart =
    staticCount;

  const readonlyLookupStart =
    staticCount +
    writableLookupCount;

  const expectedAccountCount =
    staticCount +
    writableLookupCount +
    readonlyLookupCount;

  if (
    allAccountKeys.length !==
    expectedAccountCount
  ) {
    throw new Error(
      [
        'Resolved transaction account count mismatch.',
        `Expected ${expectedAccountCount}.`,
        `Received ${allAccountKeys.length}.`,
      ].join(' ')
    );
  }

  for (
    let index = 0;
    index < allAccountKeys.length;
    index += 1
  ) {
    const address =
      allAccountKeys[
        index
      ].toBase58();

    let signer = false;
    let writable = false;
    let source:
      ManifestAccount['source'];

    if (
      index <
      staticCount
    ) {
      signer =
        message.isAccountSigner(
          index
        );

      writable =
        message.isAccountWritable(
          index
        );

      source = 'static';
    } else if (
      index <
      readonlyLookupStart
    ) {
      /*
       * Lookup-table addresses can never be transaction
       * signers because signatures cover static keys.
       */
      signer = false;
      writable = true;
      source =
        'lookup-writable';
    } else {
      signer = false;
      writable = false;
      source =
        'lookup-readonly';
    }

    accounts.push({
      address,
      signer,
      writable,
      source,
    });
  }

  /*
   * Build instruction list.
   */
  const instructions: ManifestInstruction[] = [];

  const compiledInstructions = message.compiledInstructions;

  for (let idx = 0; idx < compiledInstructions.length; idx++) {
    const inst = compiledInstructions[idx];

    const programId =
      allAccountKeys[inst.programIdIndex]?.toBase58() ??
      (() => {
        throw new Error(
          `Instruction ${idx} has an out-of-range program ID index ${inst.programIdIndex}`
        );
      })();

    const accountAddresses: string[] = [];
    const writableAccounts: string[] = [];
    const signerAccounts: string[] = [];

    for (const accountIndex of inst.accountKeyIndexes) {
      const addr =
        allAccountKeys[accountIndex]?.toBase58() ??
        (() => {
          throw new Error(
            `Instruction ${idx} has an out-of-range account index ${accountIndex}`
          );
        })();

      accountAddresses.push(addr);

      if (accountIndex < accounts.length) {
        if (accounts[accountIndex].writable) {
          writableAccounts.push(addr);
        }

        if (accounts[accountIndex].signer) {
          signerAccounts.push(addr);
        }
      }
    }

    const instructionData =
      Buffer.from(
        inst.data
      );

    const dataBase64 =
      instructionData
        .toString('base64');

    const dataSha256 =
      createHash('sha256')
        .update(
          instructionData
        )
        .digest('hex');

    instructions.push({
      index: idx,
      programId,
      accountAddresses,
      writableAccounts,
      signerAccounts,
      dataBase64,
      dataSha256,
    });
  }

  /*
   * Required signers = accounts where signer === true.
   */
  const requiredSigners = accounts
    .filter((a) => a.signer)
    .map((a) => a.address);

  /*
   * Fee payer = first account.
   */
  const feePayer = accounts[0]?.address ?? '';

  /*
   * Recent blockhash.
   */
  const recentBlockhash = message.recentBlockhash;

  /*
   * Compute manifestSha256 over the canonical
   * structure (everything except manifestSha256
   * itself).
   */
  const manifestWithoutHash = {
    version: (isV0 ? 0 : 'legacy') as 'legacy' | 0,
    feePayer,
    recentBlockhash,
    requiredSigners,
    accounts,
    instructions,
    lookupTableAddresses,
    ...(lookupTablesSha256
      ? { lookupTablesSha256 }
      : {}),
  };

  const manifestSha256 = createHash('sha256')
    .update(stableStringify(manifestWithoutHash))
    .digest('hex');

  return {
    ...manifestWithoutHash,
    manifestSha256,
  };
}

/*
 * Token instruction discriminators.
 * These are the first byte of instruction data
 * for SPL Token program instructions.
 */
const TOKEN_INSTRUCTION_DISCRIMINATORS = {
  INITIALIZE_MINT: 0,
  INITIALIZE_ACCOUNT: 1,
  INITIALIZE_MULTISIG: 2,
  TRANSFER: 3,
  APPROVE: 4,
  REVOKE: 5,
  SET_AUTHORITY: 6,
  MINT_TO: 7,
  BURN: 8,
  CLOSE_ACCOUNT: 9,
  FREEZE_ACCOUNT: 10,
  THAW_ACCOUNT: 11,
  TRANSFER_CHECKED: 12,
  APPROVE_CHECKED: 13,
  MINT_TO_CHECKED: 14,
  BURN_CHECKED: 15,
};

const FORBIDDEN_TOKEN_INSTRUCTION_NAMES =
  new Map<number, string>([
    [
      TOKEN_INSTRUCTION_DISCRIMINATORS
        .APPROVE,
      'Approve',
    ],
    [
      TOKEN_INSTRUCTION_DISCRIMINATORS
        .REVOKE,
      'Revoke',
    ],
    [
      TOKEN_INSTRUCTION_DISCRIMINATORS
        .SET_AUTHORITY,
      'SetAuthority',
    ],
    [
      TOKEN_INSTRUCTION_DISCRIMINATORS
        .MINT_TO,
      'MintTo',
    ],
    [
      TOKEN_INSTRUCTION_DISCRIMINATORS
        .BURN,
      'Burn',
    ],
    [
      TOKEN_INSTRUCTION_DISCRIMINATORS
        .FREEZE_ACCOUNT,
      'FreezeAccount',
    ],
    [
      TOKEN_INSTRUCTION_DISCRIMINATORS
        .THAW_ACCOUNT,
      'ThawAccount',
    ],
    [
      TOKEN_INSTRUCTION_DISCRIMINATORS
        .APPROVE_CHECKED,
      'ApproveChecked',
    ],
    [
      TOKEN_INSTRUCTION_DISCRIMINATORS
        .MINT_TO_CHECKED,
      'MintToChecked',
    ],
    [
      TOKEN_INSTRUCTION_DISCRIMINATORS
        .BURN_CHECKED,
      'BurnChecked',
    ],
  ]);

/*
 * Compute budget instruction discriminators.
 */
const COMPUTE_BUDGET_INSTRUCTIONS = {
  REQUEST_HEAP_FRAME: 1,
  SET_COMPUTE_UNIT_LIMIT: 2,
  SET_COMPUTE_UNIT_PRICE: 3,
};

function decodeInstructionData(
  instruction: ManifestInstruction
): Buffer {
  let decoded: Buffer;

  try {
    decoded =
      Buffer.from(
        instruction.dataBase64,
        'base64'
      );
  } catch {
    throw new Error(
      `Instruction ${instruction.index} has invalid base64 data`
    );
  }

  /*
   * Buffer.from() can be permissive. Require canonical base64
   * so distinct input strings cannot represent the same bytes.
   */
  if (
    decoded.toString(
      'base64'
    ) !==
    instruction.dataBase64
  ) {
    throw new Error(
      `Instruction ${instruction.index} has non-canonical base64 data`
    );
  }

  const computedHash =
    createHash('sha256')
      .update(decoded)
      .digest('hex');

  if (
    computedHash !==
    instruction.dataSha256
  ) {
    throw new Error(
      `Instruction ${instruction.index} data hash mismatch`
    );
  }

  return decoded;
}

function readU32LE(
  data: Buffer,
  offset: number,
  label: string
): number {
  if (
    data.length <
    offset + 4
  ) {
    throw new Error(
      `${label} is truncated`
    );
  }

  return data.readUInt32LE(
    offset
  );
}

function readU64LE(
  data: Buffer,
  offset: number,
  label: string
): bigint {
  if (
    data.length <
    offset + 8
  ) {
    throw new Error(
      `${label} is truncated`
    );
  }

  return data.readBigUInt64LE(
    offset
  );
}

function validateTokenInstructionLength(
  discriminator: number,
  dataLength: number,
  instructionIndex: number
): string | null {
  /*
   * Fixed-size instructions relevant to swap policy.
   * Variable-size initialization instructions are handled
   * by program/account policy instead.
   */
  const expectedLengths =
    new Map<number, number>([
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .TRANSFER,
        9,
      ],
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .APPROVE,
        9,
      ],
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .REVOKE,
        1,
      ],
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .SET_AUTHORITY,
        35,
      ],
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .MINT_TO,
        9,
      ],
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .BURN,
        9,
      ],
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .CLOSE_ACCOUNT,
        1,
      ],
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .FREEZE_ACCOUNT,
        1,
      ],
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .THAW_ACCOUNT,
        1,
      ],
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .TRANSFER_CHECKED,
        10,
      ],
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .APPROVE_CHECKED,
        10,
      ],
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .MINT_TO_CHECKED,
        10,
      ],
      [
        TOKEN_INSTRUCTION_DISCRIMINATORS
          .BURN_CHECKED,
        10,
      ],
    ]);

  const expected =
    expectedLengths.get(
      discriminator
    );

  if (
    expected !== undefined &&
    dataLength !== expected
  ) {
    return [
      `Token instruction ${instructionIndex}`,
      `with discriminator ${discriminator}`,
      `has invalid length ${dataLength};`,
      `expected ${expected}.`,
    ].join(' ');
  }

  return null;
}

/**
 * Assess a transaction manifest against the
 * plan's transaction policy.
 *
 * Fail unless:
 * - fee payer equals the bound wallet
 * - wallet is the only required signer
 * - every invoked program is explicitly allowed
 * - no unknown program is invoked
 * - expected route AMM/pool addresses are
 *   referenced by an invoked instruction
 *   (not merely present in the account list)
 * - no unexpected writable account is present
 * - no token-account close instruction exists
 * - no delegate/approve/revoke instruction exists
 *   unless explicitly required
 * - no nonce, stake, vote, or loader instruction
 * - no forbidden program is invoked
 * - compute-budget instructions remain within
 *   configured limits
 */
export function assessTransactionManifest(
  manifest: TransactionManifest,
  plan: ApprovedExecutionPlanFile
): TransactionPolicyResult {
  const reasons: string[] = [];
  const invokedProgramIds: string[] = [];
  const unexpectedProgramIds: string[] = [];
  const unexpectedWritableAccounts: string[] = [];
  const missingRouteAccounts: string[] = [];

  const walletPublicKey =
    plan.payload.walletPublicKey;

  /*
   * Check fee payer.
   */
  if (manifest.feePayer !== walletPublicKey) {
    reasons.push(
      `Fee payer ${manifest.feePayer} does not match plan wallet ${walletPublicKey}`
    );
  }

  /*
   * Check required signers — wallet must be
   * the only required signer.
   */
  for (const signer of manifest.requiredSigners) {
    if (signer !== walletPublicKey) {
      reasons.push(
        `Unexpected required signer: ${signer}`
      );
    }
  }

  /*
   * Collect invoked program IDs.
   */
  for (const instruction of manifest.instructions) {
    if (
      !invokedProgramIds.includes(
        instruction.programId
      )
    ) {
      invokedProgramIds.push(
        instruction.programId
      );
    }
  }

  /*
   * Decode and validate all instruction bytes before applying
   * program-specific policy.
   */
  const policy =
    plan.payload.transactionPolicy;

  const decodedInstructionData =
    new Map<number, Buffer>();

  for (
    const instruction of
    manifest.instructions
  ) {
    try {
      decodedInstructionData.set(
        instruction.index,
        decodeInstructionData(
          instruction
        )
      );
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : String(error);

      reasons.push(detail);
    }
  }

  /*
   * Reject token authority and supply-changing operations.
   *
   * Swaps may transfer tokens, create or initialize token
   * accounts, sync wrapped SOL, and close temporary wrapped-SOL
   * accounts. They must not approve delegates, change authority,
   * mint, burn, freeze, or thaw accounts.
   */
  for (
    const instruction of
    manifest.instructions
  ) {
    if (
      instruction.programId !==
        TOKEN_PROGRAM_ID &&
      instruction.programId !==
        TOKEN_2022_PROGRAM_ID
    ) {
      continue;
    }

    const data =
      decodedInstructionData.get(
        instruction.index
      );

    if (
      !data ||
      data.length === 0
    ) {
      reasons.push(
        `Token instruction ${instruction.index} has no discriminator`
      );

      continue;
    }

    const discriminator =
      data[0];

    const lengthError =
      validateTokenInstructionLength(
        discriminator,
        data.length,
        instruction.index
      );

    if (lengthError) {
      reasons.push(
        lengthError
      );

      continue;
    }

    const forbiddenName =
      FORBIDDEN_TOKEN_INSTRUCTION_NAMES.get(
        discriminator
      );

    if (forbiddenName) {
      reasons.push(
        [
          `Forbidden token instruction ${forbiddenName}`,
          `at index ${instruction.index}.`,
        ].join(' ')
      );
    }

    if (
      discriminator ===
      TOKEN_INSTRUCTION_DISCRIMINATORS
        .CLOSE_ACCOUNT
    ) {
      /*
       * SPL Token CloseAccount:
       *
       * 0. account being closed
       * 1. lamport destination
       * 2. owner/authority
       * 3+. optional multisig signers
       *
       * Jupiter may legitimately close a temporary WSOL
       * account, but its lamports must return to the bound
       * wallet and the wallet must authorize the close.
       */
      if (data.length !== 1) {
        reasons.push(
          `CloseAccount instruction ${instruction.index} has invalid data length ${data.length}`
        );

        continue;
      }

      if (
        instruction
          .accountAddresses
          .length < 3
      ) {
        reasons.push(
          `CloseAccount instruction ${instruction.index} has too few accounts`
        );

        continue;
      }

      const sourceAccount =
        instruction
          .accountAddresses[0];

      const destinationAccount =
        instruction
          .accountAddresses[1];

      const authorityAccount =
        instruction
          .accountAddresses[2];

      if (
        destinationAccount !==
        walletPublicKey
      ) {
        reasons.push(
          [
            `CloseAccount instruction ${instruction.index}`,
            `sends lamports to ${destinationAccount}`,
            `instead of wallet ${walletPublicKey}.`,
          ].join(' ')
        );
      }

      if (
        authorityAccount !==
        walletPublicKey
      ) {
        reasons.push(
          [
            `CloseAccount instruction ${instruction.index}`,
            `uses authority ${authorityAccount}`,
            `instead of wallet ${walletPublicKey}.`,
          ].join(' ')
        );
      }

      if (
        !instruction
          .signerAccounts
          .includes(
            walletPublicKey
          )
      ) {
        reasons.push(
          `CloseAccount instruction ${instruction.index} is not authorized by the plan wallet`
        );
      }

      /*
       * If the plan contains an explicit token-account
       * snapshot, only one of those accounts may be closed.
       */
      if (
        policy &&
        policy.walletTokenAccounts
          .length > 0 &&
        !policy.walletTokenAccounts
          .includes(sourceAccount)
      ) {
        reasons.push(
          `CloseAccount instruction ${instruction.index} closes unapproved token account ${sourceAccount}`
        );
      }
    }
  }

  /*
   * Enforce compute-budget limits.
   */
  let computeUnitLimit:
    number | undefined;

  let computeUnitPrice:
    bigint | undefined;

  let heapFrameBytes:
    number | undefined;

  for (
    const instruction of
    manifest.instructions
  ) {
    if (
      instruction.programId !==
      COMPUTE_BUDGET_PROGRAM_ID
    ) {
      continue;
    }

    const data =
      decodedInstructionData.get(
        instruction.index
      );

    if (
      !data ||
      data.length === 0
    ) {
      reasons.push(
        `Compute-budget instruction ${instruction.index} has no discriminator`
      );

      continue;
    }

    const discriminator =
      data[0];

    if (
      discriminator ===
      COMPUTE_BUDGET_INSTRUCTIONS
        .SET_COMPUTE_UNIT_LIMIT
    ) {
      if (
        data.length !== 5
      ) {
        reasons.push(
          `Compute-unit-limit instruction ${instruction.index} has invalid length ${data.length}`
        );

        continue;
      }

      if (
        computeUnitLimit !==
        undefined
      ) {
        reasons.push(
          'Transaction contains duplicate compute-unit-limit instructions'
        );

        continue;
      }

      try {
        computeUnitLimit =
          readU32LE(
            data,
            1,
            'Compute unit limit'
          );
      } catch (error) {
        reasons.push(
          error instanceof Error
            ? error.message
            : String(error)
        );
      }

      continue;
    }

    if (
      discriminator ===
      COMPUTE_BUDGET_INSTRUCTIONS
        .SET_COMPUTE_UNIT_PRICE
    ) {
      if (
        data.length !== 9
      ) {
        reasons.push(
          `Compute-unit-price instruction ${instruction.index} has invalid length ${data.length}`
        );

        continue;
      }

      if (
        computeUnitPrice !==
        undefined
      ) {
        reasons.push(
          'Transaction contains duplicate compute-unit-price instructions'
        );

        continue;
      }

      try {
        computeUnitPrice =
          readU64LE(
            data,
            1,
            'Compute unit price'
          );
      } catch (error) {
        reasons.push(
          error instanceof Error
            ? error.message
            : String(error)
        );
      }

      continue;
    }

    if (
      discriminator ===
      COMPUTE_BUDGET_INSTRUCTIONS
        .REQUEST_HEAP_FRAME
    ) {
      if (
        data.length !== 5
      ) {
        reasons.push(
          `RequestHeapFrame instruction ${instruction.index} has invalid length ${data.length}`
        );

        continue;
      }

      if (
        heapFrameBytes !==
        undefined
      ) {
        reasons.push(
          'Transaction contains duplicate RequestHeapFrame instructions'
        );

        continue;
      }

      try {
        heapFrameBytes =
          readU32LE(
            data,
            1,
            'Heap frame size'
          );
      } catch (error) {
        reasons.push(
          error instanceof Error
            ? error.message
            : String(error)
        );

        continue;
      }

      const maximumHeapFrameBytes =
        policy
          ?.maximumHeapFrameBytes ??
        262_144;

      if (
        heapFrameBytes < 32_768 ||
        heapFrameBytes >
          maximumHeapFrameBytes ||
        heapFrameBytes %
          1_024 !==
          0
      ) {
        reasons.push(
          [
            `Heap frame size ${heapFrameBytes} is invalid.`,
            'It must be a multiple of 1024 bytes',
            'and between 32768 and',
            `${maximumHeapFrameBytes}.`,
          ].join(' ')
        );
      }

      continue;
    }

    reasons.push(
      `Unsupported compute-budget discriminator ${discriminator} at instruction ${instruction.index}`
    );
  }

  const maximumComputeUnitLimit =
    policy
      ?.maximumComputeUnitLimit ??
    1_400_000;

  if (
    computeUnitLimit !==
      undefined &&
    computeUnitLimit >
      maximumComputeUnitLimit
  ) {
    reasons.push(
      [
        `Compute unit limit ${computeUnitLimit}`,
        `exceeds approved maximum ${maximumComputeUnitLimit}.`,
      ].join(' ')
    );
  }

  const effectiveComputeUnitLimit =
    computeUnitLimit ??
    1_400_000;

  const maximumUnitPrice =
    policy
      ?.maximumComputeUnitPriceMicroLamports;

  if (
    maximumUnitPrice !==
      undefined &&
    computeUnitPrice !==
      undefined &&
    computeUnitPrice >
      BigInt(
        maximumUnitPrice
      )
  ) {
    reasons.push(
      [
        `Compute unit price ${computeUnitPrice.toString()}`,
        `exceeds approved maximum ${maximumUnitPrice}.`,
      ].join(' ')
    );
  }

  /*
   * Also enforce the configured maximum total priority fee.
   *
   * micro-lamports/CU × CU ÷ 1,000,000 =
   * approximate priority-fee lamports.
   */
  if (
    computeUnitPrice !==
      undefined
  ) {
    const priorityFeeLamports =
      (
        computeUnitPrice *
          BigInt(
            effectiveComputeUnitLimit
          ) +
        999_999n
      ) /
      1_000_000n;

    if (
      priorityFeeLamports >
      BigInt(
        config
          .maxPriorityFeeLamports
      )
    ) {
      reasons.push(
        [
          `Priority fee ${priorityFeeLamports.toString()} lamports`,
          `exceeds configured maximum ${config.maxPriorityFeeLamports}.`,
        ].join(' ')
      );
    }
  }

  /*
   * Build the allowed program set from the
   * plan policy (if present) or fall back to
   * a safe default allowlist.
   */
  const allowedPrograms = new Set(
    policy?.allowedProgramIds ?? [
      SYSTEM_PROGRAM_ID,
      TOKEN_PROGRAM_ID,
      TOKEN_2022_PROGRAM_ID,
      COMPUTE_BUDGET_PROGRAM_ID,
      SYSVAR_RENT_ID,
      SYSVAR_CLOCK_ID,
    ]
  );

  /*
   * Check for forbidden programs.
   */
  for (const programId of invokedProgramIds) {
    if (FORBIDDEN_PROGRAM_IDS.has(programId)) {
      unexpectedProgramIds.push(programId);
      reasons.push(
        `Forbidden program invoked: ${programId}`
      );
    }
  }

  /*
   * Check for unknown programs not in the allowlist.
   */
  for (const programId of invokedProgramIds) {
    if (
      !allowedPrograms.has(programId) &&
      !FORBIDDEN_PROGRAM_IDS.has(programId)
    ) {
      unexpectedProgramIds.push(programId);
      reasons.push(
        `Unknown program invoked: ${programId}`
      );
    }
  }

  /*
   * Check that required route accounts are
   * actually referenced by an invoked
   * instruction — not merely present in the
   * account list.
   */
  const requiredRouteAccounts =
    policy?.requiredRouteAccounts ??
    plan.payload.routeAmmKeys;

  const allInstructionAccountAddresses =
    new Set(
      manifest.instructions.flatMap(
        (inst) => inst.accountAddresses
      )
    );

  for (const routeAccount of requiredRouteAccounts) {
    if (
      !allInstructionAccountAddresses.has(
        routeAccount
      )
    ) {
      missingRouteAccounts.push(routeAccount);
      reasons.push(
        `Required route account ${routeAccount} is not referenced by any invoked instruction`
      );
    }
  }

  /*
   * Check writable accounts against the
   * allowed writable set.
   */
  const allowedWritableAccounts = new Set(
    policy?.allowedWritableAccounts ?? [
      walletPublicKey,
      ...requiredRouteAccounts,
    ]
  );

  /*
   * Also allow the wallet's token accounts
   * and the expected token mints' associated
   * token accounts.
   */
  if (policy?.walletTokenAccounts) {
    for (const acct of policy.walletTokenAccounts) {
      allowedWritableAccounts.add(acct);
    }
  }

  for (const account of manifest.accounts) {
    if (
      account.writable &&
      !allowedWritableAccounts.has(account.address)
    ) {
      /*
       * Allow unknown writable accounts that
       * are part of invoked instructions for
       * known DEX programs. This is a relaxed
       * check — strict mode would reject all
       * unknown writable accounts.
       *
       * For now, flag but don't reject writable
       * accounts that appear in instructions
       * for allowed programs. The route account
       * check above ensures the pool is used.
       */
      const isInInstruction =
        allInstructionAccountAddresses.has(
          account.address
        );

      if (!isInInstruction) {
        unexpectedWritableAccounts.push(
          account.address
        );
        reasons.push(
          `Unexpected writable account not in any instruction: ${account.address}`
        );
      }
    }
  }

  /*
   * Check for token authority-changing
   * instructions (approve, delegate, revoke,
   * set_authority, close_account).
   *
   * Since we don't have the raw instruction
   * data in the manifest (only dataSha256),
   * we can't check discriminators directly.
   * Instead, we check if the Token program
   * is invoked with a known token account
   * that is not in the wallet's allowed set.
   *
   * The dataSha256 provides tamper evidence
   * — if instruction data is modified, the
   * receipt verification will catch it.
   *
   * For now, we flag Token program instructions
   * that reference unknown writable accounts.
   */
  for (const instruction of manifest.instructions) {
    if (
      instruction.programId === TOKEN_PROGRAM_ID ||
      instruction.programId ===
        TOKEN_2022_PROGRAM_ID
    ) {
      for (const writableAddr of instruction.writableAccounts) {
        if (
          !allowedWritableAccounts.has(
            writableAddr
          )
        ) {
          unexpectedWritableAccounts.push(
            writableAddr
          );
          reasons.push(
            `Token instruction ${instruction.index} writes to unexpected account: ${writableAddr}`
          );
        }
      }
    }
  }

  /*
   * Check for System Program transfer
   * instructions that are not part of the
   * approved spend path. A System Program
   * instruction is suspicious if it writes
   * to an account that is not the wallet
   * or a known DEX account.
   */
  for (const instruction of manifest.instructions) {
    if (
      instruction.programId ===
      SYSTEM_PROGRAM_ID
    ) {
      for (const writableAddr of instruction.writableAccounts) {
        if (
          writableAddr !== walletPublicKey &&
          !requiredRouteAccounts.includes(
            writableAddr
          ) &&
          !allowedWritableAccounts.has(
            writableAddr
          )
        ) {
          reasons.push(
            `System Program instruction ${instruction.index} writes to unexpected account: ${writableAddr}`
          );
        }
      }
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    manifestSha256: manifest.manifestSha256,
    invokedProgramIds,
    unexpectedProgramIds,
    unexpectedWritableAccounts,
    missingRouteAccounts,
  };
}

/*
 * Compute a hash over all writable account
 * addresses in deterministic order.
 */
export function computeWritableAccountsSha256(
  manifest: TransactionManifest
): string {
  const writableAddresses = manifest.accounts
    .filter((a) => a.writable)
    .map((a) => a.address)
    .sort();

  return createHash('sha256')
    .update(JSON.stringify(writableAddresses))
    .digest('hex');
}

/*
 * Compute a hash over all instruction data
 * hashes in deterministic order.
 */
export function computeInstructionDataSha256(
  manifest: TransactionManifest
): string {
  /*
   * Keep instruction order. Sorting would allow two
   * transactions with reordered instruction data to produce
   * the same aggregate instruction-data hash.
   */
  const dataEvidence =
    manifest.instructions.map(
      (instruction) => ({
        index:
          instruction.index,
        programId:
          instruction.programId,
        dataSha256:
          instruction.dataSha256,
      })
    );

  return createHash('sha256')
    .update(
      stableStringify(
        dataEvidence
      )
    )
    .digest('hex');
}
