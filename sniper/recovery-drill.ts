export {};

import type {
  ExecutionCheckpoint,
  FaultInjector,
} from './fault-injection.js';

import {
  faultAt,
  noFaults,
} from './fault-injection.js';

interface DrillResult {
  checkpoint: string;
  passed: boolean;
  duplicateSend: boolean;
  duplicateRiskCommit: boolean;
  duplicateAudit: boolean;
  converged: boolean;
  error?: string;
}

async function runCheckpointDrill(
  checkpoint: ExecutionCheckpoint,
  setup: () => Promise<{
    planId: string;
    execute: (fi: FaultInjector) => Promise<void>;
    settle: () => Promise<void>;
    archive: () => Promise<void>;
    getSentCount: () => number;
    getAuditCount: (event: string) => number;
    getCompletedTrades: () => number;
    getSettlementStatus: () => Promise<string>;
  }>
): Promise<DrillResult> {
  try {
    const ctx = await setup();
    const fi = faultAt(checkpoint);

    let auditBefore = 0;
    let tradesBefore = 0;

    try {
      auditBefore = ctx.getAuditCount('candidate.execution.confirmed');
      tradesBefore = ctx.getCompletedTrades();
    } catch {
      /* may not have audit/risk yet */
    }

    /*
     * First attempt: should throw at the checkpoint.
     */
    let sentAfterFirst = 0;

    try {
      await ctx.execute(fi);
    } catch {
      /* expected */
    }

    try {
      await ctx.settle();
    } catch {
      /* may not be ready for settlement */
    }

    try {
      await ctx.archive();
    } catch {
      /* may not be ready for archiving */
    }

    sentAfterFirst = ctx.getSentCount();

    /*
     * Second attempt: no fault. Should converge.
     */
    try {
      await ctx.execute(noFaults);
    } catch {
      /* may already be past execution */
    }

    try {
      await ctx.settle();
    } catch {
      /* may already be settled */
    }

    try {
      await ctx.archive();
    } catch {
      /* may already be archived */
    }

    const sentAfterSecond = ctx.getSentCount();
    const auditAfter = ctx.getAuditCount('candidate.execution.confirmed');
    const tradesAfter = ctx.getCompletedTrades();

    let settlementStatus = 'unknown';

    try {
      settlementStatus = await ctx.getSettlementStatus();
    } catch {
      /* settlement may not exist */
    }

    const duplicateSend = sentAfterSecond > 1;
    const duplicateRiskCommit = tradesAfter - tradesBefore > 1;
    const duplicateAudit = auditAfter - auditBefore > 1;
    const converged = settlementStatus === 'committed' || sentAfterFirst <= 1;

    return {
      checkpoint,
      passed: !duplicateSend && !duplicateRiskCommit && !duplicateAudit && converged,
      duplicateSend,
      duplicateRiskCommit,
      duplicateAudit,
      converged,
    };
  } catch (error) {
    return {
      checkpoint,
      passed: false,
      duplicateSend: false,
      duplicateRiskCommit: false,
      duplicateAudit: false,
      converged: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main():
  Promise<void> {
  const [jsonFlag] = process.argv.slice(2);

  if (
    jsonFlag !== undefined &&
    jsonFlag !== '--json'
  ) {
    throw new Error(
      'Usage: npm run sniper:recovery-drill -- [--json]'
    );
  }

  console.error(
    'Recovery drill requires a live test environment with ' +
    'fake RPC. Run the fault-injection tests directly:\n' +
    '  npm run test -- --test-name "fault"\n' +
    '  npm run test -- --test-name "lifecycle"\n\n' +
    'This command is a documentation wrapper. The actual ' +
    'drill is the test suite.'
  );

  const checkpoints: string[] = [
    'risk-reserved',
    'signing-recorded',
    'broadcast-prepared',
    'transaction-sent',
    'submitted-recorded',
    'risk-settled',
    'execution-terminal',
    'plan-outcome-recorded',
    'audit-recorded',
    'archive-written',
    'archive-indexed',
  ];

  const report = {
    command: 'recovery-drill',
    note: 'Run npm run test to execute the actual fault-injection and lifecycle tests.',
    checkpoints,
    acceptanceCriteria: {
      noDuplicateSend: true,
      noDuplicateRiskCommit: true,
      noDuplicateAudit: true,
      finalStateConverged: true,
    },
  };

  if (jsonFlag === '--json') {
    console.log(
      JSON.stringify(report, null, 2)
    );
  } else {
    console.log(
      [
        'RECOVERY DRILL',
        `Checkpoints: ${checkpoints.length}`,
        'Run: npm run test -- --test-name "fault"',
        'Run: npm run test -- --test-name "lifecycle"',
      ].join(' | ')
    );

    for (const cp of checkpoints) {
      console.log(`  ${cp}`);
    }
  }

  process.exitCode = 0;
}

main().catch(
  (error: unknown) => {
    console.error(
      `Recovery drill failed: ${
        error instanceof Error
          ? error.message
          : String(error)
      }`
    );

    process.exitCode = 2;
  }
);
