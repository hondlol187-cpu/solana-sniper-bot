import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VersionedTransaction,
} from '@solana/web3.js';

import {
  buildJitoBundle,
  estimateBundleFeeLamports,
} from '../sniper/jito-bundle.js';

/**
 * Create a mock VersionedTransaction for testing.
 * Only the serialize() method is needed by buildJitoBundle.
 */
function mockVersionedTx(size = 100): VersionedTransaction {
  return {
    serialize: () => Buffer.alloc(size, 0x41),
  } as unknown as VersionedTransaction;
}

test(
  'jito bundle: empty transactions rejects',
  () => {
    assert.throws(
      () => buildJitoBundle([]),
      /at least one transaction/
    );
  }
);

test(
  'jito bundle: exceeds max transactions rejects',
  () => {
    const versioned = mockVersionedTx();

    assert.throws(
      () => buildJitoBundle(Array(6).fill(versioned)),
      /exceeds max transactions/
    );
  }
);

test(
  'jito bundle: valid single transaction builds',
  () => {
    const versioned = mockVersionedTx(200);

    const bundle = buildJitoBundle([versioned]);

    assert.equal(bundle.transactions.length, 1);
    assert.ok(bundle.encodedSize > 0);
  }
);

test(
  'jito bundle: fee estimation scales with transaction count',
  () => {
    const versioned = mockVersionedTx(150);

    const single = buildJitoBundle([versioned]);
    const triple = buildJitoBundle(
      [versioned, versioned, versioned]
    );

    const singleFee = estimateBundleFeeLamports(single, 100_000);
    const tripleFee = estimateBundleFeeLamports(triple, 100_000);

    assert.equal(singleFee, 100_000);
    assert.equal(tripleFee, 300_000);
  }
);

test(
  'jito bundle: exceeds size limit rejects',
  () => {
    const huge = mockVersionedTx(60_000);

    assert.throws(
      () =>
        buildJitoBundle(
          [huge, huge, huge, huge],
          { maxBundleSizeBytes: 100_000 }
        ),
      /exceeds limit/
    );
  }
);