import {
  CandidateStatus,
  approveCandidate,
  listCandidates,
  rejectCandidate,
} from './candidate-store.js';

function printUsage(): void {
  console.log(`
Usage:

  npm run sniper:candidates -- list
  npm run sniper:candidates -- list pending

  npm run sniper:candidates -- approve <signature> <exact-mint>

  npm run sniper:candidates -- reject <signature> <reason>
`);
}

async function list(
  status?: string
): Promise<void> {
  const validStatuses:
    CandidateStatus[] = [
    'pending',
    'approved',
    'rejected',
  ];

  if (
    status &&
    !validStatuses.includes(
      status as CandidateStatus
    )
  ) {
    throw new Error(
      `Unknown status: ${status}`
    );
  }

  const candidates =
    await listCandidates(
      status as
        | CandidateStatus
        | undefined
    );

  if (candidates.length === 0) {
    console.log(
      'No candidates found'
    );

    return;
  }

  for (
    const candidate of candidates
  ) {
    console.log(
      [
        candidate.status.toUpperCase(),
        candidate.signature,
        candidate.baseMint,
        candidate.poolAddress,
        `${candidate.pool.liquiditySol} SOL`,
      ].join(' | ')
    );
  }
}

async function main(): Promise<void> {
  const [
    command,
    first,
    ...remaining
  ] = process.argv.slice(2);

  if (!command) {
    printUsage();
    return;
  }

  if (command === 'list') {
    await list(first);
    return;
  }

  if (command === 'approve') {
    const signature = first;
    const mint = remaining[0];

    if (!signature || !mint) {
      throw new Error(
        'approve requires signature and exact mint'
      );
    }

    const candidate =
      await approveCandidate(
        signature,
        mint
      );

    console.log(
      [
        'APPROVED',
        candidate.signature,
        candidate.baseMint,
        'No trade was executed.',
      ].join(' | ')
    );

    return;
  }

  if (command === 'reject') {
    const signature = first;
    const reason =
      remaining.join(' ');

    if (!signature || !reason) {
      throw new Error(
        'reject requires signature and reason'
      );
    }

    const candidate =
      await rejectCandidate(
        signature,
        reason
      );

    console.log(
      [
        'REJECTED',
        candidate.signature,
        reason,
      ].join(' | ')
    );

    return;
  }

  throw new Error(
    `Unknown command: ${command}`
  );
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : String(error)
  );

  process.exitCode = 1;
});
