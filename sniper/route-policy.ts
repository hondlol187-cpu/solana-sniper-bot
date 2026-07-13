import {
  JupiterQuote,
  SOL_MINT,
} from './jupiter.js';

import { config } from './config.js';

export interface RouteAssessment {
  ok: boolean;
  reasons: string[];

  hopCount: number;
  labels: string[];
  ammKeys: string[];
}

interface RouteAssessmentInput {
  approvedPoolAddress: string;
  expectedBaseMint: string;
  expectedQuoteMint: string;
}

type SwapInfoLike = {
  label?: unknown;
  ammKey?: unknown;
  inputMint?: unknown;
  outputMint?: unknown;
};

function asObject(
  value: unknown
): Record<string, unknown> | null {
  if (
    !value ||
    typeof value !== 'object'
  ) {
    return null;
  }

  return value as Record<
    string,
    unknown
  >;
}

function readString(
  value: unknown
): string | undefined {
  return typeof value === 'string'
    ? value
    : undefined;
}

function readSwapInfo(
  step: unknown
): SwapInfoLike | null {
  const stepObject =
    asObject(step);

  if (!stepObject) {
    return null;
  }

  const swapInfo =
    asObject(stepObject.swapInfo);

  if (!swapInfo) {
    return null;
  }

  return swapInfo as SwapInfoLike;
}

export function assessQuoteAgainstApprovedPool(
  quote: JupiterQuote,
  input: RouteAssessmentInput
): RouteAssessment {
  const reasons: string[] = [];

  if (
    input.expectedQuoteMint !==
    SOL_MINT
  ) {
    reasons.push(
      'Approved candidate is not a WSOL-quoted pool'
    );
  }

  if (
    quote.inputMint !== SOL_MINT
  ) {
    reasons.push(
      `Quote input mint is ${quote.inputMint}, expected ${SOL_MINT}`
    );
  }

  if (
    quote.outputMint !==
    input.expectedBaseMint
  ) {
    reasons.push(
      `Quote output mint is ${quote.outputMint}, expected ${input.expectedBaseMint}`
    );
  }

  if (
    !Array.isArray(quote.routePlan) ||
    quote.routePlan.length === 0
  ) {
    reasons.push(
      'Quote route plan is empty'
    );

    return {
      ok: false,
      reasons,
      hopCount: 0,
      labels: [],
      ammKeys: [],
    };
  }

  const swapInfos =
    quote.routePlan
      .map((step) =>
        readSwapInfo(step)
      )
      .filter(
        (
          step
        ): step is SwapInfoLike =>
          step !== null
      );

  if (
    swapInfos.length !==
    quote.routePlan.length
  ) {
    reasons.push(
      'Some route legs are missing swapInfo'
    );
  }

  const labels = swapInfos.map(
    (info) =>
      readString(info.label) ??
      '[unknown]'
  );

  const ammKeys = swapInfos
    .map((info) =>
      readString(info.ammKey)
    )
    .filter(
      (
        value
      ): value is string =>
        Boolean(value)
    );

  if (
    config
      .requireSingleHopCandidateRoute &&
    quote.routePlan.length !== 1
  ) {
    reasons.push(
      `Route has ${quote.routePlan.length} hops; single-hop is required`
    );
  }

  for (const label of labels) {
    if (
      !label
        .toLowerCase()
        .includes('raydium')
    ) {
      reasons.push(
        `Route leg label is not Raydium: ${label}`
      );
    }
  }

  if (ammKeys.length === 0) {
    reasons.push(
      'Route does not expose an ammKey for attestation'
    );
  } else if (
    !ammKeys.includes(
      input.approvedPoolAddress
    )
  ) {
    reasons.push(
      `No route leg ammKey matches approved pool ${input.approvedPoolAddress}`
    );
  }

  const firstInputMint =
    readString(
      swapInfos[0]?.inputMint
    );

  const finalOutputMint =
    readString(
      swapInfos.at(-1)?.outputMint
    );

  if (
    firstInputMint &&
    firstInputMint !== SOL_MINT
  ) {
    reasons.push(
      `First route input mint is ${firstInputMint}, expected ${SOL_MINT}`
    );
  }

  if (
    finalOutputMint &&
    finalOutputMint !==
      input.expectedBaseMint
  ) {
    reasons.push(
      `Final route output mint is ${finalOutputMint}, expected ${input.expectedBaseMint}`
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    hopCount:
      quote.routePlan.length,
    labels,
    ammKeys,
  };
}
