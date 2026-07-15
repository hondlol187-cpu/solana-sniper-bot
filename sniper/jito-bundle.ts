import {
  VersionedTransaction,
} from '@solana/web3.js';

export interface JitoBundle {
  transactions: VersionedTransaction[];
  encodedSize: number;
}

export interface BundleBuildOptions {
  maxBundleSizeBytes: number;
  maxTransactions: number;
}

const DEFAULT_OPTIONS: BundleBuildOptions = {
  maxBundleSizeBytes: 200_000,
  maxTransactions: 5,
};

export function buildJitoBundle(
  transactions: VersionedTransaction[],
  options?: Partial<BundleBuildOptions>
): JitoBundle {
  const cfg = { ...DEFAULT_OPTIONS, ...options };

  if (transactions.length === 0) {
    throw new Error('Bundle must contain at least one transaction');
  }

  if (transactions.length > cfg.maxTransactions) {
    throw new Error(
      `Bundle exceeds max transactions: ${transactions.length} > ${cfg.maxTransactions}`
    );
  }

  const serialized = transactions.map((tx) =>
    tx.serialize()
  );

  const totalSize = serialized.reduce(
    (sum, buf) => sum + buf.length,
    0
  );

  if (totalSize > cfg.maxBundleSizeBytes) {
    throw new Error(
      `Bundle size ${totalSize} bytes exceeds limit ${cfg.maxBundleSizeBytes}`
    );
  }

  return {
    transactions,
    encodedSize: totalSize,
  };
}

export function estimateBundleFeeLamports(
  bundle: JitoBundle,
  tipLamports: number
): number {
  return tipLamports * bundle.transactions.length;
}