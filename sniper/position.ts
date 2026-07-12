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

import {
  OpenPositionState,
  clearState,
} from './state.js';

import {
  retry,
  RpcPool,
} from './rpc.js';

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, milliseconds)
  );

function minimum(
  left: bigint,
  right: bigint
): bigint {
  return left < right ? left : right;
}

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
      if (
        Buffer.isBuffer(
          item.account.data
        )
      ) {
        return total;
      }

      const data =
        item.account
          .data as ParsedAccountData;

      const amount =
        data.parsed?.info?.tokenAmount
          ?.amount;

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

export async function getBalanceWithFailover(
  rpcPool: RpcPool,
  owner: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  return rpcPool.call((connection) =>
    getRawTokenBalance(
      connection,
      owner,
      mint
    )
  );
}

export async function waitForBalanceIncrease(
  rpcPool: RpcPool,
  owner: PublicKey,
  mint: PublicKey,
  balanceBefore: bigint
): Promise<bigint> {
  for (
    let attempt = 0;
    attempt < 30;
    attempt += 1
  ) {
    const currentBalance =
      await getBalanceWithFailover(
        rpcPool,
        owner,
        mint
      );

    if (currentBalance > balanceBefore) {
      return (
        currentBalance - balanceBefore
      );
    }

    await sleep(1_000);
  }

  throw new Error(
    'Token balance did not increase after the purchase'
  );
}

async function obtainExitQuote(
  mint: PublicKey,
  amount: bigint
) {
  return retry(
    'Jupiter exit quote',
    () =>
      getQuote(
        mint.toBase58(),
        SOL_MINT,
        amount,
        config
          .emergencyExitMaxPriceImpactPct
      )
  );
}

async function executeExit(
  rpcPool: RpcPool,
  position: OpenPositionState,
  mint: PublicKey
): Promise<string> {
  if (!config.keypair) {
    throw new Error(
      'Cannot exit without a live signer'
    );
  }

  for (
    let attempt = 1;
    attempt <= config.operationRetries;
    attempt += 1
  ) {
    const currentBalance =
      await getBalanceWithFailover(
        rpcPool,
        config.walletPublicKey,
        mint
      );

    const purchasedAmount = BigInt(
      position.purchasedAmountRaw
    );

    /*
     * Never sell more than this bot purchased.
     * This protects pre-existing holdings.
     */
    const amountToSell = minimum(
      currentBalance,
      purchasedAmount
    );

    if (amountToSell <= 0n) {
      console.warn(
        'Purchased position is no longer present'
      );

      await clearState();

      return 'POSITION_ALREADY_CLOSED';
    }

    const quote =
      await obtainExitQuote(
        mint,
        amountToSell
      );

    const builtSwap =
      await buildSwapTransaction(
        quote,
        config.walletPublicKey
      );

    try {
      return await simulateAndSend(
        rpcPool.current(),
        config.keypair,
        builtSwap
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        `Exit attempt ${attempt} failed: ${message}`
      );

      /*
       * The transaction may have been broadcast but
       * confirmation may have timed out. Check the
       * balance before building another transaction.
       */
      const balanceAfterError =
        await getBalanceWithFailover(
          rpcPool,
          config.walletPublicKey,
          mint
        );

      if (
        balanceAfterError <
        currentBalance
      ) {
        console.warn(
          'Token balance decreased after the error; treating exit as submitted'
        );

        return 'EXIT_SUBMITTED_CONFIRMATION_UNKNOWN';
      }

      if (
        attempt <
        config.operationRetries
      ) {
        rpcPool.rotate();

        await sleep(
          Math.min(
            attempt * 2_000,
            10_000
          )
        );
      }
    }
  }

  throw new Error(
    'All exit attempts failed; position state was preserved for recovery'
  );
}

export async function monitorAndExit(
  rpcPool: RpcPool,
  position: OpenPositionState
): Promise<string> {
  if (
    !config.liveTrading ||
    !config.keypair
  ) {
    throw new Error(
      'Position monitoring requires live mode'
    );
  }

  const mint = new PublicKey(
    position.mint
  );

  const entryLamports = BigInt(
    position.entryLamports
  );

  const deadline =
    new Date(
      position.createdAt
    ).getTime() +
    config.maxHoldMinutes * 60_000;

  while (true) {
    try {
      const currentBalance =
        await getBalanceWithFailover(
          rpcPool,
          config.walletPublicKey,
          mint
        );

      const purchasedAmount = BigInt(
        position.purchasedAmountRaw
      );

      const amountToValue = minimum(
        currentBalance,
        purchasedAmount
      );

      if (amountToValue <= 0n) {
        console.warn(
          'Position appears to be closed'
        );

        await clearState();

        return 'POSITION_ALREADY_CLOSED';
      }

      const exitQuote =
        await obtainExitQuote(
          mint,
          amountToValue
        );

      const expectedLamports = BigInt(
        exitQuote.outAmount
      );

      const multiplier =
        Number(expectedLamports) /
        Number(entryLamports);

      const lossPct =
        (1 - multiplier) * 100;

      console.log(
        `Position ${multiplier.toFixed(
          3
        )}x; estimated loss ${lossPct.toFixed(
          2
        )}%`
      );

      const takeProfit =
        multiplier >=
        config.targetMultiplier;

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

        const signature =
          await executeExit(
            rpcPool,
            position,
            mint
          );

        await clearState();

        return signature;
      }
    } catch (error) {
      /*
       * Do not crash and abandon an open position
       * because of a temporary RPC/Jupiter failure.
       */
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        `Position monitor error: ${message}`
      );

      rpcPool.rotate();
    }

    await sleep(
      config.pollIntervalSeconds *
        1_000
    );
  }
}
