import {
  AddressLookupTableAccount,
  Connection,
  PublicKey,
} from '@solana/web3.js';

/**
 * Narrow RPC interface used while verifying a simulation
 * artifact. Keeping this interface small makes the trusted
 * path testable without a live Solana RPC.
 */
export interface SimulationArtifactRpc {
  getCurrentSlot(): Promise<number>;
  getCurrentBlockHeight(): Promise<number>;

  isRecentBlockhashValid(
    blockhash: string
  ): Promise<boolean>;

  loadAddressLookupTable(
    address: PublicKey
  ): Promise<AddressLookupTableAccount | null>;
}

/**
 * Production implementation backed by the same Connection
 * that simulated the transaction.
 */
export class ConnectionSimulationArtifactRpc
implements SimulationArtifactRpc {
  constructor(
    private readonly connection: Connection
  ) {}

  async getCurrentSlot(): Promise<number> {
    return this.connection.getSlot(
      'processed'
    );
  }

  async getCurrentBlockHeight(): Promise<number> {
    return this.connection.getBlockHeight(
      'processed'
    );
  }

  async isRecentBlockhashValid(
    blockhash: string
  ): Promise<boolean> {
    const result =
      await this.connection.isBlockhashValid(
        blockhash,
        {
          commitment: 'processed',
        }
      );

    return result.value;
  }

  async loadAddressLookupTable(
    address: PublicKey
  ): Promise<AddressLookupTableAccount | null> {
    const result =
      await this.connection
        .getAddressLookupTable(
          address,
          {
            commitment: 'processed',
          }
        );

    return result.value;
  }
}
