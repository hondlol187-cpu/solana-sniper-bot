import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test(
  'journal records and retrieves bundle entries',
  async () => {
    const { JitoBundleJournal } = await import('../sniper/jito-bundle-journal.js');

    const dir = await mkdtemp(join(tmpdir(), 'jito-journal-test-'));

    try {
      const journal = new JitoBundleJournal(dir);
      await journal.init();

      await journal.record({
        planId: 'plan1',
        artifactId: 'artifact1',
        attemptId: 'attempt1',
        bundleId: 'bundle_abc',
        txSignature: 'sig_xyz',
        tipAmount: 100_000,
        submissionState: 'prepared',
      });

      const entry = journal.get('attempt1');
      assert.ok(entry);
      assert.equal(entry!.bundleId, 'bundle_abc');
      assert.equal(entry!.submissionState, 'prepared');
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }
);

test(
  'journal updates submission state',
  async () => {
    const { JitoBundleJournal } = await import('../sniper/jito-bundle-journal.js');

    const dir = await mkdtemp(join(tmpdir(), 'jito-journal-update-'));

    try {
      const journal = new JitoBundleJournal(dir);
      await journal.init();

      await journal.record({
        planId: 'plan1',
        artifactId: 'artifact1',
        attemptId: 'attempt2',
        tipAmount: 100_000,
        submissionState: 'prepared',
      });

      await journal.updateState('attempt2', 'submitted', { bundleId: 'bundle_new' });

      const entry = journal.get('attempt2');
      assert.equal(entry!.submissionState, 'submitted');
      assert.equal(entry!.bundleId, 'bundle_new');
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }
);

test(
  'journal finds entries by bundle ID',
  async () => {
    const { JitoBundleJournal } = await import('../sniper/jito-bundle-journal.js');

    const dir = await mkdtemp(join(tmpdir(), 'jito-journal-bundle-'));

    try {
      const journal = new JitoBundleJournal(dir);
      await journal.init();

      await journal.record({
        planId: 'plan1',
        artifactId: 'artifact1',
        attemptId: 'attempt3',
        bundleId: 'bundle_lookup',
        tipAmount: 100_000,
        submissionState: 'submitted',
      });

      const found = journal.getByBundleId('bundle_lookup');
      assert.ok(found);
      assert.equal(found!.attemptId, 'attempt3');
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }
);

test(
  'journal returns ambiguous entries',
  async () => {
    const { JitoBundleJournal } = await import('../sniper/jito-bundle-journal.js');

    const dir = await mkdtemp(join(tmpdir(), 'jito-journal-ambig-'));

    try {
      const journal = new JitoBundleJournal(dir);
      await journal.init();

      await journal.record({
        planId: 'plan1', artifactId: 'a1', attemptId: 'a_landed',
        bundleId: 'b1', tipAmount: 100_000, submissionState: 'landed',
      });

      await journal.record({
        planId: 'plan2', artifactId: 'a2', attemptId: 'a_ambiguous',
        bundleId: 'b2', tipAmount: 100_000, submissionState: 'ambiguous',
      });

      await journal.record({
        planId: 'plan3', artifactId: 'a3', attemptId: 'a_submitted',
        bundleId: 'b3', tipAmount: 100_000, submissionState: 'submitted',
      });

      const ambiguous = journal.getAmbiguous();
      assert.equal(ambiguous.length, 2);
      assert.ok(ambiguous.some(e => e.attemptId === 'a_ambiguous'));
      assert.ok(ambiguous.some(e => e.attemptId === 'a_submitted'));
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }
);

test(
  'journal summary counts by state',
  async () => {
    const { JitoBundleJournal } = await import('../sniper/jito-bundle-journal.js');

    const dir = await mkdtemp(join(tmpdir(), 'jito-journal-summary-'));

    try {
      const journal = new JitoBundleJournal(dir);
      await journal.init();

      await journal.record({
        planId: 'p1', artifactId: 'a1', attemptId: 's1',
        bundleId: 'b1', tipAmount: 50_000, submissionState: 'landed',
      });

      await journal.record({
        planId: 'p2', artifactId: 'a2', attemptId: 's2',
        bundleId: 'b2', tipAmount: 50_000, submissionState: 'landed',
      });

      await journal.record({
        planId: 'p3', artifactId: 'a3', attemptId: 's3',
        bundleId: 'b3', tipAmount: 50_000, submissionState: 'rejected',
      });

      const summary = journal.getSummary();
      assert.equal(summary.totalEntries, 3);
      assert.equal(summary.byState.landed, 2);
      assert.equal(summary.byState.rejected, 1);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }
);

test(
  'journal persists entries to disk',
  async () => {
    const { JitoBundleJournal } = await import('../sniper/jito-bundle-journal.js');

    const dir = await mkdtemp(join(tmpdir(), 'jito-journal-persist-'));

    try {
      const journal = new JitoBundleJournal(dir);
      await journal.init();

      await journal.record({
        planId: 'p1', artifactId: 'a1', attemptId: 'persist1',
        bundleId: 'bp1', tipAmount: 100_000, submissionState: 'submitted',
      });

      const files = await readdir(dir);
      assert.ok(files.some(f => f.endsWith('.jsonl')));

      const content = await readFile(join(dir, files[0]), 'utf8');
      assert.ok(content.includes('persist1'));
      assert.ok(content.includes('submitted'));
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  }
);