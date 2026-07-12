import { Connection } from '@solana/web3.js';

import { config } from './config.js';

const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) =>
    setTimeout(resolve, milliseconds)
  );

export class RpcPool {
  private readonly connections: Connection[];
  private currentIndex = 0;

  constructor(urls = config.rpcUrls) {
    if (urls.length === 0) {
      throw new Error(
        'At least one RPC URL is required'
      );
    }

    this.connections = urls.map(
      (url) =>
        new Connection(url, {
          commitment: 'confirmed',
          confirmTransactionInitialTimeout:
            30_000,
        })
    );
  }

  current(): Connection {
    return this.connections[
      this.currentIndex
    ];
  }

  rotate(): Connection {
    this.currentIndex =
      (this.currentIndex + 1) %
      this.connections.length;

    console.warn(
      `Switching to RPC ${
        this.currentIndex + 1
      }/${this.connections.length}`
    );

    return this.current();
  }

  async call<T>(
    operation: (
      connection: Connection
    ) => Promise<T>,
    attempts = Math.max(
      config.operationRetries,
      this.connections.length
    )
  ): Promise<T> {
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

        console.warn(
          `RPC attempt ${attempt}/${attempts} failed: ${message}`
        );

        if (attempt < attempts) {
          this.rotate();

          await sleep(
            Math.min(
              1_000 * 2 ** (attempt - 1),
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
  attempts = config.operationRetries
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

      console.warn(
        `${name} attempt ${attempt}/${attempts} failed: ${message}`
      );

      if (attempt < attempts) {
        await sleep(
          Math.min(
            1_000 * 2 ** (attempt - 1),
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
