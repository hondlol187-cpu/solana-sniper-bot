import {
  createHash,
} from 'node:crypto';

import {
  Keypair,
  VersionedTransaction,
} from '@solana/web3.js';

import type {
  SimulationReceipt,
} from './execution-plan.js';

function sha256(
  data:
    Uint8Array |
    Buffer
): string {
  return createHash('sha256')
    .update(data)
    .digest('hex');
}

function assertHexSha256(
  value: string,
  label: string
): void {
  if (
    !/^[0-9a-f]{64}$/.test(
      value
    )
  ) {
    throw new Error(
      `${label} is not a valid SHA-256`
    );
  }
}

export interface VerifiedSignedTransaction {
  signedTransaction:
    VersionedTransaction;

  signedTransactionBytes:
    Buffer;

  transactionMessageSha256:
    string;

  unsignedSerializedTransactionSha256:
    string;
}

export function signVerifiedSimulationTransaction(
  unsignedSerializedTransaction:
    Buffer,
  receipt:
    SimulationReceipt,
  signer:
    Keypair
): VerifiedSignedTransaction {
  if (
    receipt.transactionPolicyOk !==
    true
  ) {
    throw new Error(
      'Simulation receipt transaction policy is not approved'
    );
  }

  assertHexSha256(
    receipt
      .serializedTransactionSha256,
    'Receipt serialized transaction hash'
  );

  assertHexSha256(
    receipt
      .transactionMessageSha256,
    'Receipt transaction message hash'
  );

  if (
    !receipt
      .transactionPolicySha256
  ) {
    throw new Error(
      'Simulation receipt has no transaction-policy hash'
    );
  }

  const unsignedHash =
    sha256(
      unsignedSerializedTransaction
    );

  if (
    unsignedHash !==
    receipt
      .serializedTransactionSha256
  ) {
    throw new Error(
      'Unsigned transaction bytes do not match simulation receipt'
    );
  }

  let transaction:
    VersionedTransaction;

  try {
    transaction =
      VersionedTransaction
        .deserialize(
          unsignedSerializedTransaction
        );
  } catch {
    throw new Error(
      'Failed to deserialize verified simulation transaction'
    );
  }

  const messageHash =
    sha256(
      transaction.message
        .serialize()
    );

  if (
    messageHash !==
    receipt
      .transactionMessageSha256
  ) {
    throw new Error(
      'Transaction message does not match simulation receipt'
    );
  }

  const feePayer =
    transaction.message
      .staticAccountKeys[0];

  if (!feePayer) {
    throw new Error(
      'Verified transaction has no fee payer'
    );
  }

  if (
    !feePayer.equals(
      signer.publicKey
    )
  ) {
    throw new Error(
      'Signer does not match verified transaction fee payer'
    );
  }

  if (
    receipt.walletPublicKey !==
    signer.publicKey.toBase58()
  ) {
    throw new Error(
      'Signer does not match simulation receipt wallet'
    );
  }

  if (
    transaction.message
      .header
      .numRequiredSignatures !==
    1
  ) {
    throw new Error(
      'Verified transaction requires unexpected signatures'
    );
  }

  transaction.sign([
    signer,
  ]);

  /*
   * Signing may change signature bytes, but must never change
   * the transaction message.
   */
  const messageHashAfterSigning =
    sha256(
      transaction.message
        .serialize()
    );

  if (
    messageHashAfterSigning !==
    receipt
      .transactionMessageSha256
  ) {
    throw new Error(
      'Transaction message changed while signing'
    );
  }

  return {
    signedTransaction:
      transaction,

    signedTransactionBytes:
      Buffer.from(
        transaction.serialize()
      ),

    transactionMessageSha256:
      messageHashAfterSigning,

    unsignedSerializedTransactionSha256:
      unsignedHash,
  };
}
