import { Connection } from '@solana/web3.js';

import { config } from './config.js';
import { audit } from './audit.js';

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, milliseconds)
  );

const genesisHashes = {
  'mainnet-beta':
    '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',

  devnet:
    'EtWTRABZaYq6iMfeYKouRu166VU2xqa1',

  testnet:
    '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
} as const;

interface RpcEntry {
  connection: Connection;
  safeLabel: string;
}

function safeRpcLabel(
  rawUrl: string
): string {
  try {
    const url = new URL(rawUrl);

    /*
     * Do not log path segments, query strings or
     * credentials from private RPC URLs.
     */
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return '[INVALID_RPC_URL]';
  }
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer:
    | ReturnType<typeof setTimeout>
    | undefined;

  const timeout = new Promise<never>(
    (_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error(
              `${label} timed out after ${timeoutMs}ms`
            )
          ),
        timeoutMs
      );
    }
  );

  try {
    return await Promise.race([
      operation,
      timeout,
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function validateRpc(
  entry: RpcEntry
): Promise<void> {
  const expectedGenesis =
    genesisHashes[
      config.expectedCluster
    ];

  const genesisHash =
    await withTimeout(
      entry.connection.getGenesisHash(),
      config.rpcHealthTimeoutMs,
      `${entry.safeLabel} genesis check`
    );

  if (
    genesisHash !== expectedGenesis
  ) {
    throw new Error(
      [
        `RPC ${entry.safeLabel} is on the wrong cluster.`,
        `Expected ${config.expectedCluster}.`,
        `Expected genesis ${expectedGenesis}.`,
        `Received ${genesisHash}.`,
      ].join(' ')
    );
  }

  const slot = await withTimeout(
    entry.connection.getSlot(
      'processed'
    ),
    config.rpcHealthTimeoutMs,
    `${entry.safeLabel} slot check`
  );

  const blockTime =
    await withTimeout(
      entry.connection.getBlockTime(
        slot
      ),
      config.rpcHealthTimeoutMs,
      `${entry.safeLabel} block-time check`
    );

  if (blockTime === null) {
    throw new Error(
      `RPC ${entry.safeLabel} returned no block time`
    );
  }

  const lagSeconds =
    Math.max(
      0,
      Math.floor(Date.now() / 1_000) -
        blockTime
    );

  if (
    lagSeconds >
    config.maxRpcLagSeconds
  ) {
    throw new Error(
      `RPC ${entry.safeLabel} is ${lagSeconds}s behind`
    );
  }

  await withTimeout(
    entry.connection.getLatestBlockhash(
      'processed'
    ),
    config.rpcHealthTimeoutMs,
    `${entry.safeLabel} blockhash check`
  );

  await audit('rpc.validated', {
    rpc: entry.safeLabel,
    cluster: config.expectedCluster,
    slot,
    lagSeconds,
  });
}

export class RpcPool {
  private entries: RpcEntry[];
  private currentIndex = 0;
  private initialized = false;

  constructor(
    urls = config.rpcUrls
  ) {
    if (urls.length === 0) {
      throw new Error(
        'At least one RPC URL is required'
      );
    }

    this.entries = urls.map(
      (url) => ({
        connection:
          new Connection(url, {
            commitment: 'confirmed',
            confirmTransactionInitialTimeout:
              30_000,
          }),

        safeLabel:
          safeRpcLabel(url),
      })
    );
  }

  async initialize(): Promise<void> {
    const results =
      await Promise.allSettled(
        this.entries.map(
          async (entry) => {
            await validateRpc(entry);
            return entry;
          }
        )
      );

    const healthy: RpcEntry[] = [];

    for (
      let index = 0;
      index < results.length;
      index += 1
    ) {
      const result =
        results[index];

      if (
        result.status === 'fulfilled'
      ) {
        healthy.push(result.value);
      } else {
        const entry =
          this.entries[index];

        const reason =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);

        console.warn(
          `Removing unhealthy RPC ${entry.safeLabel}: ${reason}`
        );

        await audit(
          'rpc.rejected',
          {
            rpc: entry.safeLabel,
            reason,
          }
        );
      }
    }

    if (healthy.length === 0) {
      throw new Error(
        'No healthy RPC endpoints remain'
      );
    }

    this.entries = healthy;
    this.currentIndex = 0;
    this.initialized = true;

    await audit(
      'rpc.pool.initialized',
      {
        healthyCount:
          healthy.length,
        cluster:
          config.expectedCluster,
      }
    );
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'RpcPool.initialize() must be called first'
      );
    }
  }

  current(): Connection {
    this.assertInitialized();

    return this.entries[
      this.currentIndex
    ].connection;
  }

  currentLabel(): string {
    this.assertInitialized();

    return this.entries[
      this.currentIndex
    ].safeLabel;
  }

  rotate(): Connection {
    this.assertInitialized();

    this.currentIndex =
      (this.currentIndex + 1) %
      this.entries.length;

    console.warn(
      `Switching to RPC ${this.currentLabel()}`
    );

    return this.current();
  }

  async call<T>(
    operation: (
      connection: Connection
    ) => Promise<T>,
    attempts = Math.max(
      config.operationRetries,
      this.entries.length
    )
  ): Promise<T> {
    this.assertInitialized();

    let lastError: unknown;

    for (
      let attempt = 1;
      attempt <= attempts;
      attempt += 1
    ) {
      try {
        return await operation(
          this.current()
        );
      } catch (error) {
        lastError = error;

        const message =
          error instanceof Error
            ? error.message
            : String(error);

        await audit(
          'rpc.operation.failed',
          {
            rpc:
              this.currentLabel(),
            attempt,
            attempts,
            message,
          }
        );

        if (attempt < attempts) {
          this.rotate();

          await sleep(
            Math.min(
              1_000 *
                2 ** (attempt - 1),
              10_000
            )
          );
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(String(lastError));
  }
}

export async function retry<T>(
  name: string,
  operation: () => Promise<T>,
  attempts =
    config.operationRetries
): Promise<T> {
  let lastError: unknown;

  for (
    let attempt = 1;
    attempt <= attempts;
    attempt += 1
  ) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      await audit(
        'operation.retry',
        {
          name,
          attempt,
          attempts,
          message,
        }
      );

      if (attempt < attempts) {
        await sleep(
          Math.min(
            1_000 *
              2 ** (attempt - 1),
            15_000
          )
        );
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError));
}
