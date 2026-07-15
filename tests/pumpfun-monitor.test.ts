import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parsePumpfunLaunchEvent,
  captureBondingCurveSnapshot,
} from '../sniper/pumpfun-monitor.js';

test(
  'pumpfun monitor: launch detection with bonding curve keyword',
  () => {
    const logs = [
      'Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke [1]',
      'Program log: Instruction: Initialize',
      'Program log: bonding_curve=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      'Program log: mint=11111111111111111111111111111111',
      'Program log: creator=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    ];

    const result = parsePumpfunLaunchEvent(
      'SigAAABBBBCCCCCCCDDDDDDDDDDDDDDDDDDDDDD',
      999999,
      logs
    );

    assert.equal(result.accepted, true);
    assert.equal(result.signal.source, 'pumpfun');
    assert.equal(
      result.signal.mint,
      '11111111111111111111111111111111'
    );

    assert.equal(
      result.signal.bondingCurveAccount,
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    );
  }
);

test(
  'pumpfun monitor: rejection for empty signature',
  () => {
    const result = parsePumpfunLaunchEvent(
      '',
      123,
      ['log']
    );

    assert.equal(result.accepted, false);
    assert.ok(
      result.rejectionReason?.includes('Invalid')
    );
  }
);

test(
  'pumpfun monitor: bonding curve snapshot complete state',
  () => {
    const snapshot = captureBondingCurveSnapshot(
      'MintComplete',
      'CurveAddr',
      {
        virtualTokenReserves: '0',
        virtualSolReserves: '500000000000',
        realSolReserves: '500000000000',
        tokenTotalSupply: '1000000000',
        complete: true,
      }
    );

    assert.equal(snapshot.complete, true);
    assert.equal(snapshot.mint, 'MintComplete');
  }
);