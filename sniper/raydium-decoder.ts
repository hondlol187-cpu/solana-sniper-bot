import bs58 from 'bs58';

import {
  Connection,
  PartiallyDecodedInstruction,
  PublicKey,
} from '@solana/web3.js';

import {
  DecodedRaydiumCandidate,
  WRAPPED_SOL_MINT,
} from './pool-validator.js';

import {
  RAYDIUM_AMM_V4,
  RaydiumPoolSignal,
} from './monitor.js';

import { config } from './config.js';
import { audit } from './audit.js';

const SPL_TOKEN_PROGRAM =
  new PublicKey(
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
  );

const ASSOCIATED_TOKEN_PROGRAM =
  new PublicKey(
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
  );

const SYSTEM_PROGRAM =
  new PublicKey(
    '11111111111111111111111111111111'
  );

const RENT_SYSVAR =
  new PublicKey(
    'SysvarRent111111111111111111111111111111111'
  );

const INITIALIZE2_TAG = 1;
const INITIALIZE2_DATA_LENGTH = 26;
const INITIALIZE2_ACCOUNT_COUNT = 21;

function readU64LE(
  data: Buffer,
  offset: number
): bigint {
  if (
    offset < 0 ||
    offset + 8 > data.length
  ) {
    throw new Error(
      'Initialize2 data is truncated'
    );
  }

  return data.readBigUInt64LE(
    offset
  );
}

function bigintToSafeNumber(
  value: bigint,
  label: string
): number {
  if (
    value >
    BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new Error(
      `${label} exceeds JavaScript safe integer range`
    );
  }

  return Number(value);
}

function requireAccount(
  accounts: PublicKey[],
  index: number,
  label: string
): PublicKey {
  const account = accounts[index];

  if (!account) {
    throw new Error(
      `Initialize2 is missing ${label} at account index ${index}`
    );
  }

  return account;
}

function assertAccountEquals(
  accounts: PublicKey[],
  index: number,
  expected: PublicKey,
  label: string
): void {
  const actual = requireAccount(
    accounts,
    index,
    label
  );

  if (!actual.equals(expected)) {
    throw new Error(
      [
        `Unexpected ${label}.`,
        `Expected ${expected.toBase58()}.`,
        `Received ${actual.toBase58()}.`,
      ].join(' ')
    );
  }
}

function isPartiallyDecoded(
  instruction: unknown
): instruction is PartiallyDecodedInstruction {
  if (
    !instruction ||
    typeof instruction !== 'object'
  ) {
    return false;
  }

  return (
    'programId' in instruction &&
    'accounts' in instruction &&
    'data' in instruction
  );
}

function decodeInstruction(
  instruction: PartiallyDecodedInstruction,
  signal: RaydiumPoolSignal
): DecodedRaydiumCandidate | null {
  if (
    !instruction.programId.equals(
      RAYDIUM_AMM_V4
    )
  ) {
    return null;
  }

  const data = Buffer.from(
    bs58.decode(instruction.data)
  );

  if (
    data.length === 0 ||
    data[0] !== INITIALIZE2_TAG
  ) {
    return null;
  }

  if (
    data.length !==
    INITIALIZE2_DATA_LENGTH
  ) {
    throw new Error(
      `Initialize2 has unexpected data length ${data.length}`
    );
  }

  const accounts =
    instruction.accounts;

  if (
    accounts.length !==
    INITIALIZE2_ACCOUNT_COUNT
  ) {
    throw new Error(
      `Initialize2 has ${accounts.length} accounts; expected ${INITIALIZE2_ACCOUNT_COUNT}`
    );
  }

  /*
   * Official Raydium Initialize2 account prefix:
   * 0 SPL Token
   * 1 Associated Token
   * 2 System Program
   * 3 Rent Sysvar
   */
  assertAccountEquals(
    accounts,
    0,
    SPL_TOKEN_PROGRAM,
    'SPL Token program'
  );

  assertAccountEquals(
    accounts,
    1,
    ASSOCIATED_TOKEN_PROGRAM,
    'Associated Token program'
  );

  assertAccountEquals(
    accounts,
    2,
    SYSTEM_PROGRAM,
    'System program'
  );

  assertAccountEquals(
    accounts,
    3,
    RENT_SYSVAR,
    'Rent sysvar'
  );

  const poolAddress =
    requireAccount(
      accounts,
      4,
      'AMM pool'
    );

  const coinMint =
    requireAccount(
      accounts,
      8,
      'coin mint'
    );

  const pcMint =
    requireAccount(
      accounts,
      9,
      'PC mint'
    );

  const coinVault =
    requireAccount(
      accounts,
      10,
      'coin vault'
    );

  const pcVault =
    requireAccount(
      accounts,
      11,
      'PC vault'
    );

  const nonce = data[1];

  const openTimeRaw =
    readU64LE(data, 2);

  const initialPcAmount =
    readU64LE(data, 10);

  const initialCoinAmount =
    readU64LE(data, 18);

  if (
    initialPcAmount <= 0n ||
    initialCoinAmount <= 0n
  ) {
    throw new Error(
      'Initialize2 contains empty initial reserves'
    );
  }

  const openTime =
    bigintToSafeNumber(
      openTimeRaw,
      'openTime'
    );

  /*
   * Normalize pool orientation so quoteMint is
   * always WSOL. The existing validator supports
   * only WSOL-quoted pools.
   */
  if (
    pcMint.equals(
      WRAPPED_SOL_MINT
    )
  ) {
    return {
      signal,

      decoderVersion:
        'raydium-amm-v4-initialize2-v1',

      poolAddress:
        poolAddress.toBase58(),

      baseMint:
        coinMint.toBase58(),

      quoteMint:
        pcMint.toBase58(),

      baseVault:
        coinVault.toBase58(),

      quoteVault:
        pcVault.toBase58(),

      nonce,
      openTime,

      initialBaseAmountRaw:
        initialCoinAmount.toString(),

      initialQuoteAmountRaw:
        initialPcAmount.toString(),
    };
  }

  if (
    coinMint.equals(
      WRAPPED_SOL_MINT
    )
  ) {
    return {
      signal,

      decoderVersion:
        'raydium-amm-v4-initialize2-v1',

      poolAddress:
        poolAddress.toBase58(),

      /*
       * Coin and PC sides are reversed so WSOL
       * remains the quote asset.
       */
      baseMint:
        pcMint.toBase58(),

      quoteMint:
        coinMint.toBase58(),

      baseVault:
        pcVault.toBase58(),

      quoteVault:
        coinVault.toBase58(),

      nonce,
      openTime,

      initialBaseAmountRaw:
        initialPcAmount.toString(),

      initialQuoteAmountRaw:
        initialCoinAmount.toString(),
    };
  }

  throw new Error(
    'Initialize2 pool is not paired with WSOL'
  );
}

export async function decodeRaydiumInitialize2(
  connection: Connection,
  signal: RaydiumPoolSignal
): Promise<DecodedRaydiumCandidate> {
  const ageSeconds =
    (
      Date.now() -
      new Date(
        signal.detectedAt
      ).getTime()
    ) / 1_000;

  if (
    !Number.isFinite(ageSeconds) ||
    ageSeconds < 0 ||
    ageSeconds >
      config.maxPoolSignalAgeSeconds
  ) {
    throw new Error(
      `Raydium signal is stale: ${ageSeconds.toFixed(
        1
      )} seconds`
    );
  }

  if (
    signal.programId !==
    RAYDIUM_AMM_V4.toBase58()
  ) {
    throw new Error(
      'Signal has the wrong program ID'
    );
  }

  const transaction =
    await connection.getParsedTransaction(
      signal.signature,
      {
        commitment:
          config
            .requireFinalizedPoolTransaction
            ? 'finalized'
            : 'confirmed',

        maxSupportedTransactionVersion: 0,
      }
    );

  if (!transaction) {
    throw new Error(
      'Initialize2 transaction could not be loaded'
    );
  }

  if (
    transaction.slot !== signal.slot
  ) {
    throw new Error(
      [
        'Signal slot does not match transaction slot.',
        `Signal: ${signal.slot}.`,
        `Transaction: ${transaction.slot}.`,
      ].join(' ')
    );
  }

  const candidates:
    DecodedRaydiumCandidate[] = [];

  for (
    const instruction of
    transaction.transaction.message.instructions
  ) {
    if (
      !isPartiallyDecoded(instruction)
    ) {
      continue;
    }

    const candidate =
      decodeInstruction(
        instruction,
        signal
      );

    if (candidate) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    throw new Error(
      'No strict Raydium Initialize2 instruction was found'
    );
  }

  if (candidates.length > 1) {
    throw new Error(
      'Transaction contains multiple Initialize2 instructions; refusing ambiguous decode'
    );
  }

  const candidate =
    candidates[0];

  await audit(
    'pool.initialize2.decoded',
    {
      signature:
        signal.signature,

      poolAddress:
        candidate.poolAddress,

      baseMint:
        candidate.baseMint,

      quoteMint:
        candidate.quoteMint,

      baseVault:
        candidate.baseVault,

      quoteVault:
        candidate.quoteVault,

      nonce:
        candidate.nonce,

      openTime:
        candidate.openTime,

      initialBaseAmountRaw:
        candidate.initialBaseAmountRaw,

      initialQuoteAmountRaw:
        candidate.initialQuoteAmountRaw,
    }
  );

  return candidate;
}
