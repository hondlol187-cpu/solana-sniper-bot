import { PublicKey } from '@solana/web3.js';

import type {
  ApprovedExecutionPlanFile,
} from './execution-plan.js';

import { config } from './config.js';

export interface ExecutionPlanEnvironmentAssessment {
  ok: boolean;
  reasons: string[];
}

export function assessExecutionPlanEnvironment(
  file: ApprovedExecutionPlanFile
): ExecutionPlanEnvironmentAssessment {
  const reasons: string[] = [];
  const payload = file.payload;

  const currentWallet =
    config.walletPublicKey.toBase58();

  if (
    payload.walletPublicKey !==
    currentWallet
  ) {
    reasons.push(
      [
        'Plan wallet does not match current wallet.',
        `Plan: ${payload.walletPublicKey}.`,
        `Current: ${currentWallet}.`,
      ].join(' ')
    );
  }

  if (
    payload.expectedCluster !==
    config.expectedCluster
  ) {
    reasons.push(
      [
        'Plan cluster does not match current config.',
        `Plan: ${payload.expectedCluster}.`,
        `Current: ${config.expectedCluster}.`,
      ].join(' ')
    );
  }

  const currentBuyLamports =
    BigInt(
      Math.floor(
        config.buyAmountSol *
        1_000_000_000
      )
    ).toString();

  if (
    payload.buyLamports !==
    currentBuyLamports
  ) {
    reasons.push(
      [
        'Plan buy amount does not match current config.',
        `Plan: ${payload.buyLamports}.`,
        `Current: ${currentBuyLamports}.`,
      ].join(' ')
    );
  }

  if (
    payload.quoteInAmount !==
    payload.buyLamports
  ) {
    reasons.push(
      [
        'Plan quote input does not match plan buy amount.',
        `QuoteInAmount: ${payload.quoteInAmount}.`,
        `BuyLamports: ${payload.buyLamports}.`,
      ].join(' ')
    );
  }

  if (
    payload.exactMint !==
    payload.quoteOutputMint
  ) {
    reasons.push(
      [
        'Plan exact mint does not match quote output mint.',
        `ExactMint: ${payload.exactMint}.`,
        `QuoteOutputMint: ${payload.quoteOutputMint}.`,
      ].join(' ')
    );
  }

  try {
    new PublicKey(payload.walletPublicKey);
  } catch {
    reasons.push(
      'Plan walletPublicKey is invalid'
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
  };
}
