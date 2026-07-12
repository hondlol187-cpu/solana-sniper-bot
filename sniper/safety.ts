import {
  Connection,
  ParsedAccountData,
  PublicKey,
} from '@solana/web3.js';

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

  if (data.program !== 'spl-token' && data.program !== 'spl-token-2022') {
    reasons.push(`Unexpected mint program: ${data.program}`);
  }

  const info = data.parsed?.info;

  if (!info) {
    reasons.push('Missing parsed mint information');
  } else {
    if (info.mintAuthority !== null) {
      reasons.push('Mint authority is still active');
    }

    if (info.freezeAuthority !== null) {
      reasons.push('Freeze authority is still active');
    }

    if (info.isInitialized !== true) {
      reasons.push('Mint is not initialized');
    }

    const decimals = Number(info.decimals);

    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 12) {
      reasons.push(`Suspicious decimals value: ${info.decimals}`);
    }
  }

  return {
    safe: reasons.length === 0,
    reasons,
  };
}
