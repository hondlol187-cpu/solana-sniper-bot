import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mkdtemp,
  mkdir,
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
  'only ready -> signing -> submitted -> confirmed',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
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
  'confirmed execution cannot begin again',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
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
  'failure forbidden after submission',
  async () => {
    await configureEnvironment();
    await cleanAll();

    const {
      beginExecution,
      markExecutionSigning,
      markExecutionSubmitted,
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

    await markExecutionSubmitted(
      journal.executionId,
      'test-signature'
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

    const results =
      await Promise.allSettled([
        markExecutionSubmitted(
          journal.executionId,
          'sig-a'
        ),
        markExecutionSubmitted(
          journal.executionId,
          'sig-b'
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
