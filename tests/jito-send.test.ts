import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Jito send tests.
 *
 * The jito-send module imports audit which imports config,
 * so we test via dynamic import with env vars set.
 */
async function importJitoSend() {
  return import('../sniper/jito-send.js');
}

test(
  'jito send: all endpoints fail triggers RPC fallback',
  async () => {
    const { sendJitoBundle } = await importJitoSend();

    let rpcCalled = false;

    const result = await sendJitoBundle(
      ['AAECAwQFBgc='],
      {
        jitoTipAccounts: ['Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY'],
        jitoApiUrl: 'https://invalid.jito.example.com/api/v1/bundles',
        tipLamports: 100_000,
        timeoutMs: 1000,
        rpcSendTransaction: async () => {
          rpcCalled = true;
          return 'fallbackSignature';
        },
      }
    );

    assert.equal(result.fallbackUsed, true);
    assert.equal(result.success, true);
    assert.ok(rpcCalled);
  }
);

test(
  'jito send: RPC fallback also fails reports error',
  async () => {
    const { sendJitoBundle } = await importJitoSend();

    const result = await sendJitoBundle(
      ['AAECAwQFBgc='],
      {
        jitoTipAccounts: ['Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY'],
        jitoApiUrl: 'https://invalid.jito.example.com/api/v1/bundles',
        tipLamports: 100_000,
        timeoutMs: 1000,
        rpcSendTransaction: async () => {
          throw new Error('RPC connection refused');
        },
      }
    );

    assert.equal(result.success, false);
    assert.ok(result.error);
    assert.equal(result.fallbackUsed, true);
  }
);