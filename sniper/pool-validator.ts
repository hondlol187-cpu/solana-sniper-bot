import {
  Connection,
  ParsedAccountData,
  PublicKey,
} from '@solana/web3.js';

import { config } from './config.js';
import { audit } from './audit.js';
import { checkMintSafety } from './safety.js';

import {
  RAYDIUM_AMM_V4,
  RaydiumPoolSignal,
} from './monitor.js';

export const WRAPPED_SOL_MINT =
  new PublicKey(
    'So11111111111111111111111111111111111111112'
  );

export interface DecodedRaydiumCandidate {
  signal: RaydiumPoolSignal;

  poolAddress: string;

  baseMint: string;
  quoteMint: string;

  baseVault: string;
  quoteVault: string;
}

export interface ValidatedRaydiumPool {
  signature: string;
  slot: number;

  poolAddress: string;

  baseMint: string;
  quoteMint: string;

  baseVault: string;
  quoteVault: string;

  baseVaultAmountRaw: string;
  quoteVaultAmountRaw: string;

  liquiditySol: number;

  validatedAt: string;
  validated: true;
}

interface ParsedTokenAccount {
  mint: PublicKey;
  owner: PublicKey;
  amountRaw: bigint;
  decimals: number;
}

function parsePublicKey(
  value: string,
  label: string
): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(
      `${label} is not a valid public key`
    );
  }
}

function assertDistinct(
  values: PublicKey[]
): void {
  const unique = new Set(
    values.map((value) =>
      value.toBase58()
    )
  );

  if (
    unique.size !== values.length
  ) {
    throw new Error(
      'Candidate contains duplicated account addresses'
    );
  }
}

function signalAgeSeconds(
  signal: RaydiumPoolSignal
): number {
  return (
    Date.now() -
    new Date(
      signal.detectedAt
    ).getTime()
  ) / 1_000;
}

async function loadTokenAccount(
  connection: Connection,
  address: PublicKey,
  label: string
): Promise<ParsedTokenAccount> {
  const account =
    await connection.getParsedAccountInfo(
      address,
      'confirmed'
    );

  if (!account.value) {
    throw new Error(
      `${label} does not exist`
    );
  }

  if (
    Buffer.isBuffer(
      account.value.data
    )
  ) {
    throw new Error(
      `${label} could not be parsed`
    );
  }

  const data =
    account.value
      .data as ParsedAccountData;

  if (
    data.program !== 'spl-token' &&
    data.program !== 'spl-token-2022'
  ) {
    throw new Error(
      `${label} is not a token account`
    );
  }

  const info =
    data.parsed?.info;

  if (!info) {
    throw new Error(
      `${label} has no parsed token information`
    );
  }

  const mint = parsePublicKey(
    String(info.mint),
    `${label} mint`
  );

  const owner = parsePublicKey(
    String(info.owner),
    `${label} owner`
  );

  const amount =
    info.tokenAmount?.amount;

  const decimals = Number(
    info.tokenAmount?.decimals
  );

  if (
    typeof amount !== 'string'
  ) {
    throw new Error(
      `${label} has no raw token amount`
    );
  }

  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 18
  ) {
    throw new Error(
      `${label} has invalid decimals`
    );
  }

  return {
    mint,
    owner,
    amountRaw: BigInt(amount),
    decimals,
  };
}

async function assertFinalized(
  connection: Connection,
  signature: string
): Promise<void> {
  const result =
    await connection.getSignatureStatuses(
      [signature],
      {
        searchTransactionHistory: true,
      }
    );

  const status =
    result.value[0];

  if (!status) {
    throw new Error(
      'Pool transaction was not found'
    );
  }

  if (status.err) {
    throw new Error(
      `Pool transaction failed: ${JSON.stringify(
        status.err
      )}`
    );
  }

  if (
    config.requireFinalizedPoolTransaction &&
    status.confirmationStatus !==
      'finalized'
  ) {
    throw new Error(
      `Pool transaction is not finalized: ${status.confirmationStatus}`
    );
  }
}

async function assertTransactionContainsAccounts(
  connection: Connection,
  candidate: DecodedRaydiumCandidate,
  requiredAccounts: PublicKey[]
): Promise<void> {
  const transaction =
    await connection.getParsedTransaction(
      candidate.signal.signature,
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
      'Pool transaction could not be loaded'
    );
  }

  const accountKeys =
    new Set(
      transaction.transaction.message.accountKeys.map(
        (account) =>
          account.pubkey.toBase58()
      )
    );

  for (
    const account of requiredAccounts
  ) {
    if (
      !accountKeys.has(
        account.toBase58()
      )
    ) {
      throw new Error(
        `Candidate account ${account.toBase58()} was not present in the pool transaction`
      );
    }
  }

  const hasRaydiumInstruction =
    transaction.transaction.message.instructions.some(
      (instruction) =>
        instruction.programId.equals(
          RAYDIUM_AMM_V4
        )
    );

  if (!hasRaydiumInstruction) {
    throw new Error(
      'Transaction has no top-level Raydium AMM v4 instruction'
    );
  }
}

export async function validateDecodedRaydiumPool(
  connection: Connection,
  candidate: DecodedRaydiumCandidate
): Promise<ValidatedRaydiumPool> {
  const age =
    signalAgeSeconds(
      candidate.signal
    );

  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age >
      config.maxPoolSignalAgeSeconds
  ) {
    throw new Error(
      `Pool signal is stale: ${age.toFixed(
        1
      )} seconds`
    );
  }

  if (
    candidate.signal.validated !==
    false
  ) {
    throw new Error(
      'Candidate signal has an invalid validation state'
    );
  }

  if (
    candidate.signal.programId !==
    RAYDIUM_AMM_V4.toBase58()
  ) {
    throw new Error(
      'Candidate signal has an unexpected program ID'
    );
  }

  const poolAddress =
    parsePublicKey(
      candidate.poolAddress,
      'poolAddress'
    );

  const baseMint =
    parsePublicKey(
      candidate.baseMint,
      'baseMint'
    );

  const quoteMint =
    parsePublicKey(
      candidate.quoteMint,
      'quoteMint'
    );

  const baseVault =
    parsePublicKey(
      candidate.baseVault,
      'baseVault'
    );

  const quoteVault =
    parsePublicKey(
      candidate.quoteVault,
      'quoteVault'
    );

  assertDistinct([
    poolAddress,
    baseMint,
    quoteMint,
    baseVault,
    quoteVault,
  ]);

  /*
   * This validator initially supports only
   * WSOL-quoted pools. Stablecoin pools need
   * separate USD-value validation.
   */
  if (
    !quoteMint.equals(
      WRAPPED_SOL_MINT
    )
  ) {
    throw new Error(
      'Only WSOL-quoted pools are currently supported'
    );
  }

  await assertFinalized(
    connection,
    candidate.signal.signature
  );

  await assertTransactionContainsAccounts(
    connection,
    candidate,
    [
      poolAddress,
      baseMint,
      quoteMint,
      baseVault,
      quoteVault,
    ]
  );

  const poolAccount =
    await connection.getAccountInfo(
      poolAddress,
      'confirmed'
    );

  if (!poolAccount) {
    throw new Error(
      'Pool account does not exist'
    );
  }

  if (
    !poolAccount.owner.equals(
      RAYDIUM_AMM_V4
    )
  ) {
    throw new Error(
      'Pool account is not owned by Raydium AMM v4'
    );
  }

  if (poolAccount.executable) {
    throw new Error(
      'Pool state account is unexpectedly executable'
    );
  }

  const [
    baseVaultData,
    quoteVaultData,
    mintSafety,
  ] = await Promise.all([
    loadTokenAccount(
      connection,
      baseVault,
      'baseVault'
    ),

    loadTokenAccount(
      connection,
      quoteVault,
      'quoteVault'
    ),

    checkMintSafety(
      connection,
      baseMint.toBase58()
    ),
  ]);

  if (
    !baseVaultData.mint.equals(
      baseMint
    )
  ) {
    throw new Error(
      'Base vault mint does not match candidate base mint'
    );
  }

  if (
    !quoteVaultData.mint.equals(
      quoteMint
    )
  ) {
    throw new Error(
      'Quote vault mint does not match candidate quote mint'
    );
  }

  if (
    baseVaultData.amountRaw <= 0n
  ) {
    throw new Error(
      'Base vault is empty'
    );
  }

  if (
    quoteVaultData.amountRaw <= 0n
  ) {
    throw new Error(
      'Quote vault is empty'
    );
  }

  if (!mintSafety.safe) {
    throw new Error(
      `Base mint rejected: ${mintSafety.reasons.join(
        '; '
      )}`
    );
  }

  const liquiditySol =
    Number(
      quoteVaultData.amountRaw
    ) /
    10 ** quoteVaultData.decimals;

  if (
    !Number.isFinite(
      liquiditySol
    ) ||
    liquiditySol <
      config.minimumValidatedLiquiditySol
  ) {
    throw new Error(
      `Validated liquidity ${liquiditySol} SOL is below minimum ${config.minimumValidatedLiquiditySol} SOL`
    );
  }

  /*
   * Both vaults should normally share the same
   * Raydium pool authority.
   */
  if (
    !baseVaultData.owner.equals(
      quoteVaultData.owner
    )
  ) {
    throw new Error(
      'Base and quote vault owners differ'
    );
  }

  const validated: ValidatedRaydiumPool = {
    signature:
      candidate.signal.signature,

    slot:
      candidate.signal.slot,

    poolAddress:
      poolAddress.toBase58(),

    baseMint:
      baseMint.toBase58(),

    quoteMint:
      quoteMint.toBase58(),

    baseVault:
      baseVault.toBase58(),

    quoteVault:
      quoteVault.toBase58(),

    baseVaultAmountRaw:
      baseVaultData.amountRaw.toString(),

    quoteVaultAmountRaw:
      quoteVaultData.amountRaw.toString(),

    liquiditySol,

    validatedAt:
      new Date().toISOString(),

    validated: true,
  };

  await audit(
    'pool.validated',
    {
      ...validated,
    }
  );

  return validated;
}
