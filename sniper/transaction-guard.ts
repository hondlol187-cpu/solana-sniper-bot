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

export interface SpendGuardResult {
  balanceBefore: bigint;
  simulatedBalanceAfter: bigint;
  simulatedSpendLamports: bigint;
  logs: string[];
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

  const simulation =
    await connection.simulateTransaction(
      transaction,
      {
        commitment: 'processed',
        sigVerify:
          options.verifySignatures,
        replaceRecentBlockhash:
          options.replaceRecentBlockhash,

        /*
         * Request the wallet account after the
         * simulated transaction so the maximum SOL
         * outflow can be checked.
         */
        accounts: {
          encoding: 'base64',
          addresses: [
            wallet.toBase58(),
          ],
        },
      }
    );

  if (simulation.value.err) {
    throw new Error(
      `Transaction simulation failed: ${JSON.stringify(
        simulation.value.err
      )}`
    );
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
    logs:
      simulation.value.logs ?? [],
  };
}
