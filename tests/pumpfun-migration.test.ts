import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePumpfunLaunchEvent,
  captureBondingCurveSnapshot,
} from '../sniper/pumpfun-monitor.js';

import {
  detectMigrationAndLink,
  trackMigration,
  linkMigrationToRaydiumPool,
  getMigrationByMint,
  getAllMigrations,
} from '../sniper/pumpfun-migration.js';

test(
  'launch detection accepts valid pumpfun logs',
  () => {
    const logs = [
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
      'Program log: Instruction: Initialize bonding curve',
      'Program log: mint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'Program log: creator=11111111111111111111111111111112',
    ];

    const result = parsePumpfunLaunchEvent(
      '5UfDuX7W3KbLzBW7F7vGzXs7dA3BqL9mN4oP8hR2jYtK',
      123456,
      logs
    );

    assert.equal(result.accepted, true);
    assert.equal(result.signal.source, 'pumpfun');
    assert.equal(
      result.signal.signature,
      '5UfDuX7W3KbLzBW7F7vGzXs7dA3BqL9mN4oP8hR2jYtK'
    );
    assert.equal(result.signal.slot, 123456);
    assert.equal(
      result.signal.mint,
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    );
    assert.equal(
      result.signal.creator,
      '11111111111111111111111111111112'
    );
  }
);

test(
  'malformed candidate rejection for missing mint',
  () => {
    const logs = [
      'Program log: Instruction: Initialize bonding curve',
      'Program log: creator=11111111111111111111111111111112',
    ];

    const result = parsePumpfunLaunchEvent(
      '5UfDuX7W3KbLzBW7F7vGzXs7dA3BqL9mN4oP8hR2jYtK',
      123456,
      logs
    );

    assert.equal(result.accepted, false);
    assert.ok(
      result.rejectionReason?.includes('mint')
    );
  }
);

test(
  'malformed candidate rejection for non-pumpfun logs',
  () => {
    const logs = [
      'Program Transfer invoke [1]',
      'Program log: Transfer 100 SOL',
    ];

    const result = parsePumpfunLaunchEvent(
      '5UfDuX7W3KbLzBW7F7vGzXs7dA3BqL9mN4oP8hR2jYtK',
      123456,
      logs
    );

    assert.equal(result.accepted, false);
    assert.ok(
      result.rejectionReason?.includes(
        'do not indicate'
      )
    );
  }
);

test(
  'bonding curve snapshot captures data',
  () => {
    const snapshot = captureBondingCurveSnapshot(
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'BondingCurveAccount123',
      {
        virtualTokenReserves: '1000000000',
        virtualSolReserves: '100000000000',
        realSolReserves: '50000000000',
        tokenTotalSupply: '1000000000',
        complete: false,
      }
    );

    assert.equal(
      snapshot.mint,
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    );

    assert.equal(
      snapshot.bondingCurveAccount,
      'BondingCurveAccount123'
    );

    assert.equal(
      snapshot.virtualTokenReserves,
      '1000000000'
    );

    assert.equal(snapshot.complete, false);
    assert.ok(snapshot.snapshotAt);
  }
);

test(
  'migration linking to mint',
  async () => {
    const candidate = {
      mint: 'MintAddress111111111111111111111111111111',
      migrationDetectedAt: new Date().toISOString(),
      previousLifecycleStage: 'pumpfun_detected',
      bondingCurveComplete: true,
    };

    const result =
      await detectMigrationAndLink(candidate);

    assert.equal(result.accepted, true);

    const entry = getMigrationByMint(
      candidate.mint
    );

    assert.ok(entry);
    assert.equal(entry.mint, candidate.mint);
    assert.equal(
      entry.previousLifecycleStage,
      'pumpfun_detected'
    );
  }
);

test(
  'duplicate migration suppression',
  async () => {
    const mint = 'DupMint22222222222222222222222222222222';

    const candidate = {
      mint,
      migrationDetectedAt: new Date().toISOString(),
      previousLifecycleStage: 'pumpfun_detected',
      bondingCurveComplete: true,
    };

    const first = await detectMigrationAndLink(candidate);
    assert.equal(first.accepted, true);

    const second =
      await detectMigrationAndLink(candidate);
    assert.equal(second.accepted, false);
    assert.ok(
      second.reason?.includes('Duplicate')
    );
  }
);

test(
  'promotion into Raydium validation path',
  async () => {
    const mint = 'PromoMint33333333333333333333333333333';

    const candidate = {
      mint,
      raydiumPoolAddress:
        'RaydiumPoolAddress444444444444444',
      migrationDetectedAt: new Date().toISOString(),
      previousLifecycleStage: 'migration_detected',
      bondingCurveComplete: true,
    };

    const result =
      await detectMigrationAndLink(candidate);

    assert.equal(result.accepted, true);

    const entry = getMigrationByMint(mint);

    assert.ok(entry);
    assert.equal(
      entry.raydiumPoolAddress,
      'RaydiumPoolAddress444444444444444'
    );
  }
);

test(
  'source metadata preservation',
  async () => {
    const mint = 'SourceMint55555555555555555555555555555';

    const candidate = {
      mint,
      migrationSignature: 'SigAAAABBBBCCCCCCC',
      raydiumPoolAddress:
        'PoolAddress66666666666666',
      migrationDetectedAt: '2025-01-01T00:00:00Z',
      previousLifecycleStage: 'pumpfun_detected',
      bondingCurveComplete: true,
    };

    await detectMigrationAndLink(candidate);

    const entry = getMigrationByMint(mint);

    assert.ok(entry);
    assert.equal(
      entry.migrationSignature,
      'SigAAAABBBBCCCCCCC'
    );

    assert.equal(
      entry.migrationDetectedAt,
      '2025-01-01T00:00:00Z'
    );

    assert.equal(
      entry.bondingCurveComplete,
      true
    );

    const all = getAllMigrations();

    assert.ok(all.length >= 1);

    const found = all.find(
      (m) => m.mint === mint
    );

    assert.ok(found);
    assert.deepEqual(found, entry);
  }
);