import assert from 'node:assert/strict';
import test from 'node:test';

import { assessSellability } from '../sniper/verify-sellability.js';

test(
  'clear sell path passes',
  () => {
    const report = assessSellability({
      mintAddress: 'GoodToken',
      buyAmountLamports: '100000000',
      buyQuoteOutAmount: '1000000',
      sellQuoteOutAmount: '95000000',
      sellRouteFound: true,
      transferRestrictions: false,
    });

    assert.equal(report.sellable, true);
    assert.equal(report.hardReject, false);
    assert.equal(report.reasons.length, 0);
  }
);

test(
  'missing sell route fails',
  () => {
    const report = assessSellability({
      mintAddress: 'NoRouteToken',
      buyAmountLamports: '100000000',
      sellRouteFound: false,
      transferRestrictions: false,
    });

    assert.equal(report.sellable, false);
    assert.equal(report.hardReject, true);
    assert.ok(
      report.reasons.some((r) =>
        r.includes('No sell route')
      )
    );
  }
);

test(
  'extreme roundtrip loss fails',
  () => {
    const report = assessSellability({
      mintAddress: 'HoneypotToken',
      buyAmountLamports: '100000000',
      buyQuoteOutAmount: '1000000',
      sellQuoteOutAmount: '1000000',
      sellRouteFound: true,
      transferRestrictions: false,
    });

    assert.equal(report.sellable, false);
    assert.equal(report.hardReject, true);
    assert.ok(
      report.reasons.some((r) =>
        r.includes('round-trip loss')
      )
    );
  }
);

test(
  'transfer restriction fails',
  () => {
    const report = assessSellability({
      mintAddress: 'RestrictedToken',
      buyAmountLamports: '100000000',
      sellRouteFound: true,
      transferRestrictions: true,
    });

    assert.equal(report.sellable, false);
    assert.equal(report.hardReject, true);
    assert.ok(
      report.reasons.some((r) =>
        r.includes('transfer restrictions')
      )
    );
  }
);

test(
  'extreme sell tax fails',
  () => {
    const report = assessSellability({
      mintAddress: 'HighTaxToken',
      buyAmountLamports: '100000000',
      sellRouteFound: true,
      transferRestrictions: false,
      sellTaxBps: 6000,
    });

    assert.equal(report.hardReject, true);
    assert.ok(
      report.reasons.some((r) =>
        r.includes('Extreme sell tax')
      )
    );
  }
);

test(
  'artifact persistence works',
  () => {
    const report = assessSellability({
      mintAddress: 'PersistToken',
      buyAmountLamports: '100000000',
      buyQuoteOutAmount: '90000000',
      sellQuoteOutAmount: '85000000',
      sellRouteFound: true,
      transferRestrictions: false,
      sellTaxBps: 100,
      buyTaxBps: 50,
    });

    assert.equal(typeof report.estimatedBuyOutAmount, 'string');
    assert.equal(typeof report.estimatedSellBackAmount, 'string');
    assert.ok(typeof report.effectiveRoundTripLossBps === 'number');
  }
);

test(
  'release readiness blocks unsellable assets',
  () => {
    const report = assessSellability({
      mintAddress: 'BlockedToken',
      buyAmountLamports: '100000000',
      sellRouteFound: false,
      transferRestrictions: true,
      sellTaxBps: 9000,
    });

    assert.equal(report.sellable, false);
    assert.equal(report.hardReject, true);
    assert.ok(report.reasons.length >= 2);
  }
);