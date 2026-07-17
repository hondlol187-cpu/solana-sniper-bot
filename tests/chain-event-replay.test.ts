import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

test(
  'corpus fixture loads and validates all 17 event types',
  async () => {
    const { validateCorpusEvent } = await import('../sniper/chain-event-corpus.js');

    const corpusPath = join(PROJECT_ROOT, 'fixtures/chain-events/default-corpus.json');
    const content = await readFile(corpusPath, 'utf8');
    const corpus = JSON.parse(content);

    assert.equal(corpus.version, 1);
    assert.ok(corpus.events.length >= 17, `Expected at least 17 events, got ${corpus.events.length}`);

    const types = new Set(corpus.events.map((e: { type: string }) => e.type));
    assert.ok(types.has('raydium_pool_init'));
    assert.ok(types.has('malformed_instruction'));
    assert.ok(types.has('pumpfun_launch'));
    assert.ok(types.has('sellable_token'));
    assert.ok(types.has('jito_accepted_landed'));

    for (const event of corpus.events) {
      const result = validateCorpusEvent(event);
      assert.ok(result.valid, `Event ${event.id} invalid: ${result.error}`);
    }
  }
);

test(
  'replay produces deterministic results',
  async () => {
    const { replayCorpus } = await import('../sniper/replay-chain-events.js');

    const corpusPath = join(PROJECT_ROOT, 'fixtures/chain-events/default-corpus.json');

    const processor = (event: { expectedDecision: string; expectedReasonCode: string }) => ({
      decision: event.expectedDecision as 'accept' | 'reject',
      reasonCode: event.expectedReasonCode,
    });

    const summary1 = await replayCorpus(corpusPath, processor as any);
    const summary2 = await replayCorpus(corpusPath, processor as any);

    assert.equal(summary1.passed, summary2.passed);
    assert.equal(summary1.total, summary2.total);
    assert.equal(summary1.determinismVerified, true);
    assert.equal(summary2.determinismVerified, true);
  }
);

test(
  'replay detects decision mismatches',
  async () => {
    const { replayCorpus } = await import('../sniper/replay-chain-events.js');

    const corpusPath = join(PROJECT_ROOT, 'fixtures/chain-events/default-corpus.json');

    const mismatchProcessor = (_event: { id: string; expectedDecision: string; expectedReasonCode: string }) => ({
      decision: 'reject' as const,
      reasonCode: 'forced_reject',
    });

    const summary = await replayCorpus(corpusPath, mismatchProcessor as any);

    assert.ok(summary.failed > 0, 'Should have failures when all decisions are reject');
    assert.ok(summary.failedEventIds.length > 0);
  }
);

test(
  'corpus events have no secrets or real credentials',
  async () => {
    const corpusPath = join(PROJECT_ROOT, 'fixtures/chain-events/default-corpus.json');
    const content = await readFile(corpusPath, 'utf8');

    const forbidden = ['PRIVATE_KEY', 'private_key', 'secret_key', 'password=', 'bearer '];
    const lower = content.toLowerCase();

    for (const term of forbidden) {
      assert.ok(!lower.includes(term.toLowerCase()), `Corpus must not contain: ${term}`);
    }
  }
);