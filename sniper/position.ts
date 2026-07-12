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
  saveState,
} from './state.js';

import {
  retry,
  RpcPool,
} from './rpc.js';

import { audit } from './audit.js';

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

function maximum(
  left: bigint,
  right: bigint
): bigint {
  return left > right ? left : right;
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
    'Token balance did not increase after purchase'
  );
}

function safeAmountAboveBaseline(
  currentBalance: bigint,
  balanceBefore: bigint
): bigint {
  /*
   * Never permit the bot to sell below the token
   * balance that existed before the purchase.
   */
  return currentBalance > balanceBefore
    ? currentBalance - balanceBefore
    : 0n;
}

function safeSellAmount(
  currentBalance: bigint,
  position: OpenPositionState
): bigint {
  const balanceBefore = BigInt(
    position.balanceBeforeRaw
  );

  const remainingAmount = BigInt(
    position.remainingAmountRaw
  );

  const amountAboveBaseline =
    safeAmountAboveBaseline(
      currentBalance,
      balanceBefore
    );

  return minimum(
    amountAboveBaseline,
    remainingAmount
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

async function waitForBalanceChange(
  rpcPool: RpcPool,
  mint: PublicKey,
  previousBalance: bigint
): Promise<bigint> {
  let lastBalance = previousBalance;

  for (
    let attempt = 0;
    attempt <
    config.exitBalanceCheckAttempts;
    attempt += 1
  ) {
    lastBalance =
      await getBalanceWithFailover(
        rpcPool,
        config.walletPublicKey,
        mint
      );

    if (lastBalance < previousBalance) {
      return lastBalance;
    }

    await sleep(1_000);
  }

  return lastBalance;
}

async function reconcilePosition(
  position: OpenPositionState,
  previousBalance: bigint,
  currentBalance: bigint
): Promise<OpenPositionState | null> {
  const previousRemaining = BigInt(
    position.remainingAmountRaw
  );

  const observedDecrease =
    previousBalance > currentBalance
      ? previousBalance - currentBalance
      : 0n;

  const remainingAfterDecrease =
    maximum(
      previousRemaining -
        observedDecrease,
      0n
    );

  const balanceBefore = BigInt(
    position.balanceBeforeRaw
  );

  const stillAboveBaseline =
    safeAmountAboveBaseline(
      currentBalance,
      balanceBefore
    );

  /*
   * Remaining tracked position can never exceed the
   * amount currently present above the protected
   * baseline.
   */
  const reconciledRemaining =
    minimum(
      remainingAfterDecrease,
      stillAboveBaseline
    );

  if (reconciledRemaining <= 0n) {
    await clearState();
    return null;
  }

  const updated: OpenPositionState = {
    ...position,
    remainingAmountRaw:
      reconciledRemaining.toString(),
    updatedAt:
      new Date().toISOString(),
  };

  await saveState(updated);

  return updated;
}

interface ExitResult {
  signature: string;
  position: OpenPositionState | null;
}

async function executeExit(
  rpcPool: RpcPool,
  initialPosition: OpenPositionState,
  mint: PublicKey
): Promise<ExitResult> {
  if (!config.keypair) {
    throw new Error(
      'Cannot exit without a live signer'
    );
  }

  let position = initialPosition;
  let lastSignature =
    'NO_TRANSACTION_SUBMITTED';

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

    const amountToSell =
      safeSellAmount(
        currentBalance,
        position
      );

    if (amountToSell <= 0n) {
      await clearState();

      return {
        signature:
          'POSITION_ALREADY_CLOSED',
        position: null,
      };
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
      await rpcPool.ensureCurrentHealthy();

      await audit(
        'exit.broadcast.preflight',
        {
          rpc:
            rpcPool.currentLabel(),
          mint:
            mint.toBase58(),
          amountToSell:
            amountToSell.toString(),
        }
      );

      lastSignature =
        await simulateAndSend(
          rpcPool.current(),
          config.keypair,
          builtSwap
        );

      const balanceAfter =
        await waitForBalanceChange(
          rpcPool,
          mint,
          currentBalance
        );

      const reconciled =
        await reconcilePosition(
          position,
          currentBalance,
          balanceAfter
        );

      if (!reconciled) {
        return {
          signature: lastSignature,
          position: null,
        };
      }

      /*
       * A partial fill or external balance change was
       * detected. Continue exiting only the safe
       * remainder above the original baseline.
       */
      position = reconciled;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        `Exit attempt ${attempt} failed: ${message}`
      );

      /*
       * Broadcast may have succeeded even if
       * confirmation failed. Reconcile before retrying.
       */
      const balanceAfterError =
        await getBalanceWithFailover(
          rpcPool,
          config.walletPublicKey,
          mint
        );

      const reconciled =
        await reconcilePosition(
          position,
          currentBalance,
          balanceAfterError
        );

      if (!reconciled) {
        return {
          signature:
            'EXIT_SUBMITTED_CONFIRMATION_UNKNOWN',
          position: null,
        };
      }

      position = reconciled;

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

  /*
   * The updated remaining position is already saved.
   * Do not clear it.
   */
  return {
    signature: lastSignature,
    position,
  };
}

export async function monitorAndExit(
  rpcPool: RpcPool,
  initialPosition: OpenPositionState
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
    initialPosition.mint
  );

  const entryLamports = BigInt(
    initialPosition.entryLamports
  );

  const deadline =
    new Date(
      initialPosition.createdAt
    ).getTime() +
    config.maxHoldMinutes * 60_000;

  let position = initialPosition;

  while (true) {
    try {
      const currentBalance =
        await getBalanceWithFailover(
          rpcPool,
          config.walletPublicKey,
          mint
        );

      const amountToValue =
        safeSellAmount(
          currentBalance,
          position
        );

      if (amountToValue <= 0n) {
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

        const result =
          await executeExit(
            rpcPool,
            position,
            mint
          );

        if (!result.position) {
          return result.signature;
        }

        /*
         * Partial position remains. Keep monitoring and
         * attempting the exit.
         */
        position = result.position;

        console.warn(
          `Partial position remains: ${position.remainingAmountRaw}`
        );
      }
    } catch (error) {
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
