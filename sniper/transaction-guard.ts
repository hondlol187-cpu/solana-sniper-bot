import {
  Connection,
  PublicKey,
  VersionedTransaction,
} from '@solana/web3.js';

export interface SpendGuardOptions {
  expectedMaximumSpendLamports: bigint;
  replaceRecentBlockhash: boolean;
  verifySignatures: boolean;
}

export interface SimulationReturnData {
  programId: string;
  data: [string, string];
}

export interface SpendGuardResult {
  balanceBefore: bigint;
  simulatedBalanceAfter: bigint;
  simulatedSpendLamports: bigint;

  /*
   * Exact bytes represented by the transaction passed
   * to connection.simulateTransaction().
   */
  serializedTransaction: Buffer;

  logs: string[];
  contextSlot: number;
  err: unknown | null;
  unitsConsumed?: number;
  returnData?: SimulationReturnData;
}

export async function simulateWithSpendGuard(
  connection: Connection,
  transaction: VersionedTransaction,
  wallet: PublicKey,
  options: SpendGuardOptions
): Promise<SpendGuardResult> {
  const balanceBefore = BigInt(
    await connection.getBalance(
      wallet,
      'processed'
    )
  );

  /*
   * Capture the bytes immediately before simulation.
   *
   * Artifact-producing callers must set
   * replaceRecentBlockhash=false. Otherwise the RPC may
   * simulate a different message from these bytes.
   */
  const serializedTransaction = Buffer.from(
    transaction.serialize()
  );

  const simulation =
    await connection.simulateTransaction(
      transaction,
      {
        commitment: 'processed',
        sigVerify: options.verifySignatures,
        replaceRecentBlockhash:
          options.replaceRecentBlockhash,

        accounts: {
          encoding: 'base64',
          addresses: [
            wallet.toBase58(),
          ],
        },
      }
    );

  const contextSlot =
    simulation.context.slot;

  const err =
    simulation.value.err ?? null;

  const logs =
    simulation.value.logs ?? [];

  const unitsConsumed =
    simulation.value.unitsConsumed ??
    undefined;

  const rawReturnData =
    simulation.value.returnData;

  const returnData: SimulationReturnData | undefined =
    rawReturnData
      ? {
          programId:
            rawReturnData.programId,
          data: [
            rawReturnData.data[0],
            String(rawReturnData.data[1]),
          ],
        }
      : undefined;

  if (err !== null) {
    return {
      balanceBefore,
      simulatedBalanceAfter:
        balanceBefore,
      simulatedSpendLamports: 0n,
      serializedTransaction,
      logs,
      contextSlot,
      err,
      unitsConsumed,
      returnData,
    };
  }

  const simulatedWallet =
    simulation.value.accounts?.[0];

  if (!simulatedWallet) {
    throw new Error(
      [
        'RPC did not return the simulated wallet account.',
        'Transaction cannot be safely checked for unexpected SOL outflow.',
      ].join(' ')
    );
  }

  const simulatedBalanceAfter =
    BigInt(simulatedWallet.lamports);

  const simulatedSpendLamports =
    balanceBefore >
    simulatedBalanceAfter
      ? balanceBefore -
        simulatedBalanceAfter
      : 0n;

  if (
    simulatedSpendLamports >
    options.expectedMaximumSpendLamports
  ) {
    throw new Error(
      [
        'Transaction rejected because simulated SOL outflow is too high.',
        `Allowed: ${options.expectedMaximumSpendLamports} lamports.`,
        `Simulated: ${simulatedSpendLamports} lamports.`,
      ].join(' ')
    );
  }

  return {
    balanceBefore,
    simulatedBalanceAfter,
    simulatedSpendLamports,
    serializedTransaction,
    logs,
    contextSlot,
    err: null,
    unitsConsumed,
    returnData,
  };
}
