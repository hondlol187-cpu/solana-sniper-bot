import {
  Connection,
  ParsedAccountData,
  PublicKey,
} from '@solana/web3.js';

import { config } from './config.js';

export interface TokenSafetyResult {
  safe: boolean;
  reasons: string[];
}

export async function checkMintSafety(
  connection: Connection,
  mintAddress: string
): Promise<TokenSafetyResult> {
  const reasons: string[] = [];

  let mint: PublicKey;

  try {
    mint = new PublicKey(mintAddress);
  } catch {
    return {
      safe: false,
      reasons: ['Invalid mint address'],
    };
  }

  const account = await connection.getParsedAccountInfo(
    mint,
    'confirmed'
  );

  if (!account.value) {
    return {
      safe: false,
      reasons: ['Mint account does not exist'],
    };
  }

  if (Buffer.isBuffer(account.value.data)) {
    return {
      safe: false,
      reasons: ['Mint account could not be parsed'],
    };
  }

  const data = account.value.data as ParsedAccountData;

  if (
    data.program !== 'spl-token' &&
    data.program !== 'spl-token-2022'
  ) {
    reasons.push(
      `Unexpected mint program: ${data.program}`
    );
  }

  if (
    data.program === 'spl-token-2022' &&
    !config.allowToken2022
  ) {
    reasons.push(
      'Token-2022 is disabled because extensions require additional review'
    );
  }

  const info = data.parsed?.info;

  if (!info) {
    reasons.push('Missing parsed mint information');

    return {
      safe: false,
      reasons,
    };
  }

  if (info.mintAuthority !== null) {
    reasons.push('Mint authority is active');
  }

  if (info.freezeAuthority !== null) {
    reasons.push('Freeze authority is active');
  }

  if (info.isInitialized !== true) {
    reasons.push('Mint is not initialized');
  }

  const decimals = Number(info.decimals);

  if (
    !Number.isInteger(decimals) ||
    decimals < 0 ||
    decimals > 12
  ) {
    reasons.push(
      `Suspicious decimals value: ${info.decimals}`
    );
  }

  /*
   * Conservatively inspect Token-2022 extensions if support
   * was explicitly enabled.
   */
  const extensions = Array.isArray(info.extensions)
    ? info.extensions
    : [];

  const allowedExtensions = new Set([
    'metadataPointer',
    'tokenMetadata',
  ]);

  for (const extension of extensions) {
    const type = String(
      extension?.extension ??
        extension?.extensionType ??
        extension?.type ??
        'unknown'
    );

    if (!allowedExtensions.has(type)) {
      reasons.push(
        `Unreviewed Token-2022 extension: ${type}`
      );
    }
  }

  return {
    safe: reasons.length === 0,
    reasons,
  };
}
