import {
  Connection,
  PublicKey,
} from '@solana/web3.js';

export interface VerifiedExecutionRpc {
  getWalletBalance(
    wallet: PublicKey
  ): Promise<bigint>;

  isBlockhashValid(
    blockhash: string
  ): Promise<boolean>;

  getCurrentBlockHeight():
    Promise<number>;

  sendExactTransaction(
    serializedTransaction:
      Buffer
  ): Promise<string>;
}

export class ConnectionVerifiedExecutionRpc
implements VerifiedExecutionRpc {
  constructor(
    private readonly connection:
      Connection
  ) {}

  async getWalletBalance(
    wallet: PublicKey
  ): Promise<bigint> {
    return BigInt(
      await this.connection
        .getBalance(
          wallet,
          'confirmed'
        )
    );
  }

  async isBlockhashValid(
    blockhash: string
  ): Promise<boolean> {
    const result =
      await this.connection
        .isBlockhashValid(
          blockhash,
          {
            commitment:
              'processed',
          }
        );

    return result.value;
  }

  async getCurrentBlockHeight():
    Promise<number> {
    return this.connection
      .getBlockHeight(
        'processed'
      );
  }

  async sendExactTransaction(
    serializedTransaction:
      Buffer
  ): Promise<string> {
    return this.connection
      .sendRawTransaction(
        serializedTransaction,
        {
          skipPreflight: false,
          maxRetries: 0,
          preflightCommitment:
            'confirmed',
        }
      );
  }
}
