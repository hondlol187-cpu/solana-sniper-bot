import { audit } from './audit.js';

export interface JitoSendResult {
  success: boolean;
  bundleId?: string;
  error?: string;
  fallbackUsed: boolean;
  durationMs: number;
}

export interface JitoSendOptions {
  jitoTipAccounts: string[];
  jitoApiUrl: string;
  tipLamports: number;
  timeoutMs: number;
  rpcSendTransaction: (
    serialized: Buffer
  ) => Promise<string>;
}

const JITO_BUNDLE_ENDPOINTS = [
  'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://amsterdam.mainnet.block-engine.jito.wtf/api/v1/bundles',
  'https://tokyo.mainnet.block-engine.jito.wtf/api/v1/bundles',
];

async function sendViaJitoApi(
  encodedTransactions: string[],
  tipAccount: string,
  apiUrl: string,
  timeoutMs: number
): Promise<{ bundleId: string }> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [[...encodedTransactions, tipAccount]],
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Jito API returned ${response.status}: ${text.slice(0, 200)}`
      );
    }

    const json = (await response.json()) as {
      result?: string;
      error?: { message?: string };
    };

    if (json.error?.message) {
      throw new Error(json.error.message);
    }

    if (!json.result) {
      throw new Error('Jito API returned no bundle ID');
    }

    return { bundleId: json.result };
  } catch (error) {
    clearTimeout(timer);

    if ((error as Error).name === 'AbortError') {
      throw new Error('Jito API request timed out');
    }

    throw error;
  }
}

export async function sendJitoBundle(
  encodedTransactions: string[],
  options: JitoSendOptions
): Promise<JitoSendResult> {
  const start = Date.now();

  /*
   * Try each Jito tip account until one succeeds.
   */
  let lastError: string | undefined;

  for (const tipAccount of options.jitoTipAccounts) {
    for (const endpoint of JITO_BUNDLE_ENDPOINTS) {
      try {
        const { bundleId } = await sendViaJitoApi(
          encodedTransactions,
          tipAccount,
          endpoint,
          options.timeoutMs
        );

        await audit('jito.bundle.sent', {
          bundleId,
          tipAccount,
          endpoint,
          transactionCount: encodedTransactions.length,
          durationMs: Date.now() - start,
        });

        return {
          success: true,
          bundleId,
          fallbackUsed: false,
          durationMs: Date.now() - start,
        };
      } catch (error) {
        lastError =
          error instanceof Error
            ? error.message
            : String(error);
      }
    }
  }

  /*
   * All Jito endpoints failed — fall back to standard RPC.
   */
  await audit('jito.bundle.fallback', {
    reason: 'All Jito endpoints failed',
    lastError,
    durationMs: Date.now() - start,
  });

  try {
    for (const encodedTx of encodedTransactions) {
      const signature =
        await options.rpcSendTransaction(
          Buffer.from(encodedTx, 'base64')
        );

      await audit('jito.fallback.transaction.sent', {
        signature,
        durationMs: Date.now() - start,
      });
    }

    return {
      success: true,
      fallbackUsed: true,
      durationMs: Date.now() - start,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    await audit('jito.send.failed', {
      error: message,
      durationMs: Date.now() - start,
    });

    return {
      success: false,
      error: message,
      fallbackUsed: true,
      durationMs: Date.now() - start,
    };
  }
}