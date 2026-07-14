import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createHash,
} from 'node:crypto';

import {
  Keypair,
  MessageV0,
  SystemProgram,
  VersionedTransaction,
} from '@solana/web3.js';

import {
  signVerifiedSimulationTransaction,
} from '../sniper/verified-transaction.js';

function hash(
  value:
    Uint8Array |
    Buffer
) {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

function buildFixture() {
  const signer =
    Keypair.generate();

  const recipient =
    Keypair.generate()
      .publicKey;

  const message =
    MessageV0.compile({
      payerKey:
        signer.publicKey,

      instructions: [
        SystemProgram.transfer({
          fromPubkey:
            signer.publicKey,
          toPubkey:
            recipient,
          lamports: 1,
        }),
      ],

      recentBlockhash:
        '11111111111111111111111111111111',

      addressLookupTableAccounts:
        [],
    });

  const transaction =
    new VersionedTransaction(
      message
    );

  const bytes =
    Buffer.from(
      transaction.serialize()
    );

  const receipt = {
    serializedTransactionSha256:
      hash(bytes),

    transactionMessageSha256:
      hash(
        transaction.message
          .serialize()
      ),

    transactionPolicySha256:
      'a'.repeat(64),

    transactionPolicyOk:
      true,

    walletPublicKey:
      signer.publicKey
        .toBase58(),

    expectedCluster:
      'mainnet-beta',

    recentBlockhash:
      message.recentBlockhash,

    simulatedAt:
      new Date().toISOString(),

    rpcEndpoint:
      'https://rpc.example',

    contextSlot: 1,

    err: null,

    logsSha256:
      hash(
        Buffer.from('[]')
      ),

    planSha256BeforeSimulation:
      'b'.repeat(64),
  };

  return {
    signer,
    bytes,
    receipt,
  };
}

test(
  'signs exact verified bytes',
  () => {
    const fixture =
      buildFixture();

    const result =
      signVerifiedSimulationTransaction(
        fixture.bytes,
        fixture.receipt,
        fixture.signer
      );

    assert.ok(
      result
        .signedTransactionBytes
        .length > 0
    );

    assert.equal(
      result
        .transactionMessageSha256,
      fixture.receipt
        .transactionMessageSha256
    );
  }
);

test(
  'rejects modified unsigned bytes',
  () => {
    const fixture =
      buildFixture();

    const modified =
      Buffer.from(
        fixture.bytes
      );

    modified[
      modified.length - 1
    ] ^= 1;

    assert.throws(
      () =>
        signVerifiedSimulationTransaction(
          modified,
          fixture.receipt,
          fixture.signer
        ),
      /do not match simulation receipt/i
    );
  }
);

test(
  'rejects wrong signer',
  () => {
    const fixture =
      buildFixture();

    assert.throws(
      () =>
        signVerifiedSimulationTransaction(
          fixture.bytes,
          fixture.receipt,
          Keypair.generate()
        ),
      /signer does not match/i
    );
  }
);

test(
  'rejects unapproved policy receipt',
  () => {
    const fixture =
      buildFixture();

    assert.throws(
      () =>
        signVerifiedSimulationTransaction(
          fixture.bytes,
          {
            ...fixture.receipt,
            transactionPolicyOk:
              false,
          },
          fixture.signer
        ),
      /policy is not approved/i
    );
  }
);
