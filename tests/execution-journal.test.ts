import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
  lstat,
} from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

let configured = false;
let planDir: string;

async function configureEnvironment() {
  if (configured) return;

  const dir = await mkdtemp(
    join(tmpdir(), 'sniper-exec-journal-')
  );

  planDir = join(dir, 'plans');

  process.env.LIVE_TRADING = 'false';
  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';
  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';
  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';
  process.env.APPROVED_EXECUTION_PLAN_DIR =
    planDir;
  process.env.MAX_APPROVED_EXECUTION_PLAN_AGE_SECONDS =
    '30';

  configured = true;
}

async function cleanAll() {
  await configureEnvironment();

  await rm(planDir, {
    force: true,
    recursive: true,
  });

  await mkdir(planDir, {
    recursive: true,
    mode: 0o700,
  });
}

const PLAN_ID = 'test-plan-id';
const PLAN_INSTANCE_ID = 'test-instance-id';
const ARTIFACT_ID = 'test-artifact-id';

const SIGNED_TX_SHA =
  'a'.repeat(64);
const MSG_SHA =
  'b'.repeat(64);
const LAST_VALID_BLOCK_HEIGHT = 200_000_000;

function makeBroadcastEvidence(
  signature: string
) {
  return {
    transactionSignature: signature,
    signedTransactionSha256:
      SIGNED_TX_SHA,
    transactionMessageSha256:
      MSG_SHA,
    lastValidBlockHeight:
      LAST_VALID_BLOCK_HEIGHT,
  };
}

test(
  'deterministic execution ID',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      buildExecutionId,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const id1 = buildExecutionId(
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    const id2 = buildExecutionId(
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    assert.equal(id1, id2);
  }
);

test(
  'repeated beginExecution returns same journal',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const first = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    const second = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    assert.equal(
      first.executionId,
      second.executionId
    );
    assert.equal(
      first.status,
      'ready'
    );
    assert.equal(
      second.status,
      'ready'
    );
  }
);

test(
  'only ready -> signing -> broadcasting -> submitted -> confirmed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
      markExecutionSubmitted,
      markExecutionConfirmed,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    const signing =
      await markExecutionSigning(
        journal.executionId
      );

    assert.equal(
      signing.status,
      'signing'
    );

    const broadcasting =
      await markExecutionBroadcastReady(
        journal.executionId,
        makeBroadcastEvidence(
          'test-signature'
        )
      );

    assert.equal(
      broadcasting.status,
      'broadcasting'
    );

    assert.equal(
      broadcasting.transactionSignature,
      'test-signature'
    );

    const submitted =
      await markExecutionSubmitted(
        journal.executionId,
        'test-signature'
      );

    assert.equal(
      submitted.status,
      'submitted'
    );
    assert.equal(
      submitted.transactionSignature,
      'test-signature'
    );

    const confirmed =
      await markExecutionConfirmed(
        journal.executionId
      );

    assert.equal(
      confirmed.status,
      'confirmed'
    );
  }
);

test(
  'submitted execution cannot begin again',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
      markExecutionSubmitted,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    await markExecutionSigning(
      journal.executionId
    );

    await markExecutionBroadcastReady(
      journal.executionId,
      makeBroadcastEvidence(
        'test-signature'
      )
    );

    await markExecutionSubmitted(
      journal.executionId,
      'test-signature'
    );

    await assert.rejects(
      beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      ),
      /already reached/i
    );
  }
);

test(
  'broadcasting execution cannot begin again',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    await markExecutionSigning(
      journal.executionId
    );

    await markExecutionBroadcastReady(
      journal.executionId,
      makeBroadcastEvidence(
        'test-signature'
      )
    );

    await assert.rejects(
      beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      ),
      /already reached/i
    );
  }
);

test(
  'confirmed execution cannot begin again',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
      markExecutionSubmitted,
      markExecutionConfirmed,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    await markExecutionSigning(
      journal.executionId
    );

    await markExecutionBroadcastReady(
      journal.executionId,
      makeBroadcastEvidence(
        'test-signature'
      )
    );

    await markExecutionSubmitted(
      journal.executionId,
      'test-signature'
    );

    await markExecutionConfirmed(
      journal.executionId
    );

    await assert.rejects(
      beginExecution(
        PLAN_ID,
        PLAN_INSTANCE_ID,
        ARTIFACT_ID
      ),
      /already reached/i
    );
  }
);

test(
  'failure allowed before submission',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionFailed,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    const failed =
      await markExecutionFailed(
        journal.executionId,
        'signing error'
      );

    assert.equal(
      failed.status,
      'failed'
    );
    assert.equal(
      failed.failureReason,
      'signing error'
    );
  }
);

test(
  'failure forbidden after broadcasting',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
      markExecutionFailed,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    await markExecutionSigning(
      journal.executionId
    );

    await markExecutionBroadcastReady(
      journal.executionId,
      makeBroadcastEvidence(
        'test-signature'
      )
    );

    await assert.rejects(
      markExecutionFailed(
        journal.executionId,
        'too late'
      ),
      /Invalid execution transition/i
    );
  }
);

test(
  'concurrent markExecutionSubmitted allows one winner',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
      markExecutionSubmitted,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    await markExecutionSigning(
      journal.executionId
    );

    await markExecutionBroadcastReady(
      journal.executionId,
      makeBroadcastEvidence(
        'shared-sig'
      )
    );

    const results =
      await Promise.allSettled([
        markExecutionSubmitted(
          journal.executionId,
          'shared-sig'
        ),
        markExecutionSubmitted(
          journal.executionId,
          'shared-sig'
        ),
      ]);

    const fulfilled = results.filter(
      (r) => r.status === 'fulfilled'
    );

    assert.equal(
      fulfilled.length,
      1,
      'exactly one submit must succeed'
    );
  }
);

test(
  'markExecutionSubmitted rejects mismatched RPC signature',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
      markExecutionSubmitted,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    await markExecutionSigning(
      journal.executionId
    );

    await markExecutionBroadcastReady(
      journal.executionId,
      makeBroadcastEvidence(
        'deterministic-sig'
      )
    );

    await assert.rejects(
      markExecutionSubmitted(
        journal.executionId,
        'different-rpc-sig'
      ),
      /RPC signature does not match pre-broadcast signature/i
    );
  }
);

test(
  'broadcasting state can be reconciled to confirmed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionBroadcastReady,
      markExecutionConfirmed,
      loadExecutionJournal,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    await markExecutionSigning(
      journal.executionId
    );

    await markExecutionBroadcastReady(
      journal.executionId,
      makeBroadcastEvidence(
        'reconciled-sig'
      )
    );

    const confirmed =
      await markExecutionConfirmed(
        journal.executionId
      );

    assert.equal(
      confirmed.status,
      'confirmed'
    );

    assert.ok(
      confirmed.submittedAt,
      'confirmed execution should fall back to broadcastPreparedAt'
    );

    const reloaded =
      await loadExecutionJournal(
        journal.executionId
      );

    assert.ok(reloaded);
    assert.equal(
      reloaded.status,
      'confirmed'
    );
  }
);

test(
  'file permissions are 0600',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    const path = join(
      planDir,
      'execution-journals',
      `${journal.executionId}.json`
    );

    const stats = await lstat(path);

    const mode = stats.mode & 0o777;

    assert.equal(
      mode,
      0o600,
      `File mode should be 0600, got ${mode.toString(8)}`
    );
  }
);

test(
  'corrupt journal fails closed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      loadExecutionJournal,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    const path = join(
      planDir,
      'execution-journals',
      `${journal.executionId}.json`
    );

    /*
     * Corrupt the journal file.
     */
    await writeFile(
      path,
      '{ invalid json',
      'utf8'
    );

    /*
     * markExecutionSigning should fail because
     * loadExecutionJournal will throw on parse.
     */
    await assert.rejects(
      markExecutionSigning(
        journal.executionId
      ),
      /JSON|Unexpected|SyntaxError/i
    );
  }
);

test(
  'tampered journal hash is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      loadExecutionJournal,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    const path = join(
      planDir,
      'execution-journals',
      `${journal.executionId}.json`
    );

    /*
     * Tamper with the status field without
     * updating the hash.
     */
    const parsed = JSON.parse(
      await readFile(path, 'utf8')
    );

    parsed.updatedAt =
      new Date(
        Date.parse(parsed.createdAt) +
          999_999_999
      ).toISOString();

    await writeFile(
      path,
      JSON.stringify(parsed, null, 2),
      'utf8'
    );

    await assert.rejects(
      loadExecutionJournal(
        journal.executionId
      ),
      /hash mismatch/i
    );
  }
);

test(
  'journal symlink is rejected',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      loadExecutionJournal,
    } = await import(
      '../sniper/execution-journal.js'
    );

    const { rm, symlink } = await import(
      'node:fs/promises'
    );

    const journal = await beginExecution(
      PLAN_ID,
      PLAN_INSTANCE_ID,
      ARTIFACT_ID
    );

    const path = join(
      planDir,
      'execution-journals',
      `${journal.executionId}.json`
    );

    await rm(path);
    await symlink('/dev/null', path);

    await assert.rejects(
      loadExecutionJournal(
        journal.executionId
      ),
      /symbolic link/i
    );
  }
);

test(
  'listExecutionJournals returns sorted journals',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      listExecutionJournals,
    } = await import(
      '../sniper/execution-journal.js'
    );

    await beginExecution(
      'plan-a',
      'instance-a',
      'artifact-a'
    );

    await beginExecution(
      'plan-b',
      'instance-b',
      'artifact-b'
    );

    const journals =
      await listExecutionJournals();

    assert.equal(journals.length, 2);

    /*
     * Journals should be sorted by createdAt.
     */
    assert.ok(
      journals[0].createdAt <=
        journals[1].createdAt
    );
  }
);
