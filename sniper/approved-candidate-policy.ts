import { config } from './config.js';

import type { CandidateRecord } from './candidate-store.js';
import type { ValidatedRaydiumPool } from './pool-validator.js';
import type { JupiterQuote } from './jupiter.js';

export interface ApprovedCandidateAssessment {
  ok: boolean;
  reasons: string[];

  quoteAgeMs: number;
  liquidityDropPct: number | null;
}

function roundTo(
  value: number,
  decimals: number
): number {
  const factor =
    10 ** decimals;

  return (
    Math.round(value * factor) /
    factor
  );
}

export function assessApprovedCandidateExecution(
  candidate: CandidateRecord,
  revalidatedPool: ValidatedRaydiumPool,
  quote: JupiterQuote,
  nowMs: number = Date.now()
): ApprovedCandidateAssessment {
  const reasons: string[] = [];

  const approval =
    candidate.approval;

  if (!approval) {
    reasons.push(
      'Candidate has no approval snapshot'
    );

    return {
      ok: false,
      reasons,
      quoteAgeMs: Number.POSITIVE_INFINITY,
      liquidityDropPct: null,
    };
  }

  if (
    approval.approvedPoolAddress !==
    revalidatedPool.poolAddress
  ) {
    reasons.push(
      [
        'Approved pool address does not match revalidated pool.',
        `Approved: ${approval.approvedPoolAddress}.`,
        `Current: ${revalidatedPool.poolAddress}.`,
      ].join(' ')
    );
  }

  if (
    approval.approvedQuoteMint !==
    revalidatedPool.quoteMint
  ) {
    reasons.push(
      [
        'Approved quote mint does not match revalidated pool.',
        `Approved: ${approval.approvedQuoteMint}.`,
        `Current: ${revalidatedPool.quoteMint}.`,
      ].join(' ')
    );
  }

  const quoteAgeMs =
    nowMs - quote.receivedAtMs;

  if (
    !Number.isFinite(quoteAgeMs) ||
    quoteAgeMs < 0
  ) {
    reasons.push(
      'Quote receivedAtMs is invalid'
    );
  } else {
    const maxAgeMs =
      config.candidateExecutionQuoteMaxAgeSeconds *
      1_000;

    if (quoteAgeMs > maxAgeMs) {
      reasons.push(
        [
          'Quote is too old for approved-candidate execution.',
          `AgeMs: ${quoteAgeMs}.`,
          `MaxAgeMs: ${maxAgeMs}.`,
        ].join(' ')
      );
    }
  }

  let liquidityDropPct: number | null =
    null;

  if (
    approval.approvedLiquiditySol > 0
  ) {
    liquidityDropPct = roundTo(
      (
        (
          approval.approvedLiquiditySol -
          revalidatedPool.liquiditySol
        ) /
        approval.approvedLiquiditySol
      ) * 100,
      2
    );

    if (liquidityDropPct < 0) {
      liquidityDropPct = 0;
    }

    if (
      liquidityDropPct >
      config.maxApprovedLiquidityDropPct
    ) {
      reasons.push(
        [
          'Pool liquidity dropped too far since approval.',
          `Approved: ${approval.approvedLiquiditySol} SOL.`,
          `Current: ${revalidatedPool.liquiditySol} SOL.`,
          `DropPct: ${liquidityDropPct}.`,
          `MaxDropPct: ${config.maxApprovedLiquidityDropPct}.`,
        ].join(' ')
      );
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    quoteAgeMs,
    liquidityDropPct,
  };
}
