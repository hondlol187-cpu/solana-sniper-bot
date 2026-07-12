import {
  Connection,
  ParsedAccountData,
  PublicKey,
} from '@solana/web3.js';

import { config } from './config.js';
import {
  buildSwapTransaction,
  getQuote,
  simulateAndSend,
  SOL_MINT,
} from './jupiter.js';

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, milliseconds)
  );

export async function getRawTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  const accounts =
    await connection.getParsedTokenAccountsByOwner(
      owner,
      { mint },
      'confirmed'
    );

  return accounts.value.reduce(
    (total, item) => {
      if (Buffer.isBuffer(item.account.data)) {
        return total;
      }

      const data =
        item.account.data as ParsedAccountData;

      const amount =
        data.parsed?.info?.tokenAmount?.amount;

      return (
        total +
        (typeof amount === 'string'
          ? BigInt(amount)
          : 0n)
      );
    },
    0n
  );
}

export async function waitForTokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  for (
    let attempt = 0;
    attempt < 15;
    attempt += 1
  ) {
    const balance = await getRawTokenBalance(
      connection,
      owner,
      mint
    );

    if (balance > 0n) {
      return balance;
    }

    await sleep(1_000);
  }

  throw new Error(
    'Purchased token balance did not appear'
  );
}

export async function monitorAndExit(
  connection: Connection,
  mint: PublicKey,
  entryLamports: bigint
): Promise<string> {
  if (
    !config.liveTrading ||
    !config.keypair
  ) {
    throw new Error(
      'Position monitoring is available only after a live purchase'
    );
  }

  const deadline =
    Date.now() +
    config.maxHoldMinutes * 60_000;

  while (true) {
    const tokenAmount =
      await getRawTokenBalance(
        connection,
        config.walletPublicKey,
        mint
      );

    if (tokenAmount <= 0n) {
      throw new Error(
        'Position token balance is zero'
      );
    }

    /*
     * Allow a higher price-impact limit for exits.
     * An emergency exit should not be blocked by the
     * stricter entry price-impact limit.
     */
    const exitQuote = await getQuote(
      mint.toBase58(),
      SOL_MINT,
      tokenAmount,
      config.maxExitPriceImpactPct
    );

    const expectedLamports =
      BigInt(exitQuote.outAmount);

    const multiplier =
      Number(expectedLamports) /
      Number(entryLamports);

    const lossPct =
      (1 - multiplier) * 100;

    console.log(
      `Position: ${multiplier.toFixed(
        3
      )}x; expected SOL: ${(
        Number(expectedLamports) /
        1_000_000_000
      ).toFixed(6)}`
    );

    const takeProfit =
      multiplier >= config.targetMultiplier;

    const stopLoss =
      lossPct >= config.stopLossPct;

    const timeStop =
      Date.now() >= deadline;

    if (
      takeProfit ||
      stopLoss ||
      timeStop
    ) {
      const reason = takeProfit
        ? 'take-profit'
        : stopLoss
          ? 'stop-loss'
          : 'time-stop';

      console.log(
        `Exit triggered: ${reason}`
      );

      const builtSwap =
        await buildSwapTransaction(
          exitQuote,
          config.walletPublicKey
        );

      return simulateAndSend(
        connection,
        config.keypair,
        builtSwap
      );
    }

    await sleep(
      config.pollIntervalSeconds * 1_000
    );
  }
}
