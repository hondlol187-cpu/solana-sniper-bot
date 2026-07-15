import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeHolderConcentration,
  evaluateHolderRisk,
} from '../sniper/token-holders.js';
import type { HolderEntry } from '../sniper/token-holders.js';

const sampleHolders: HolderEntry[] = [
  { address: 'A'.repeat(44), amount: '500000000', percent: 50 },
  { address: 'B'.repeat(44), amount: '200000000', percent: 20 },
  { address: 'C'.repeat(44), amount: '150000000', percent: 15 },
  { address: 'D'.repeat(44), amount: '100000000', percent: 10 },
  { address: 'E'.repeat(44), amount: '50000000', percent: 5 },
];

test(
  'concentrated holder rejection',
  () => {
    const analysis = analyzeHolderConcentration(
      [
        {
          address: 'Whale'.padEnd(44, 'X'),
          amount: '800000000',
          percent: 80,
        },
        {
          address: 'Other'.padEnd(44, 'Y'),
          amount: '200000000',
          percent: 20,
        },
      ],
      '1000000000'
    );

    assert.ok(
      analysis.topHolderPercent > 70
    );

    const risk = evaluateHolderRisk(analysis, {
      maxTopHolderPercent: 30,
    });

    assert.equal(risk.reject, true);
    assert.ok(
      risk.reasons.some((r) =>
        r.includes('Top holder')
      )
    );
  }
);

test(
  'safe distribution passes',
  () => {
    const holders: HolderEntry[] = Array.from(
      { length: 20 },
      (_, i) => ({
        address: `Holder${i}`.padEnd(44, 'X'),
        amount: String(
          50000000
        ),
        percent: 5,
      })
    );

    const analysis =
      analyzeHolderConcentration(
        holders,
        '1000000000'
      );

    const risk = evaluateHolderRisk(analysis);

    assert.equal(risk.reject, false);
    assert.equal(risk.reasons.length, 0);
  }
);

test(
  'creator concentration is detected',
  () => {
    const creator = 'Creator'.padEnd(
      44,
      'Z'
    );

    const holders: HolderEntry[] = [
      {
        address: creator,
        amount: '250000000',
        percent: 25,
        isCreator: true,
      },
      ...sampleHolders.slice(1),
    ];

    const analysis =
      analyzeHolderConcentration(
        holders,
        '1000000000',
        creator
      );

    assert.equal(
      analysis.creatorConcentration,
      25
    );

    const risk = evaluateHolderRisk(
      analysis,
      {
        maxCreatorConcentration: 15,
      }
    );

    assert.equal(risk.reject, true);
  }
);

test(
  'top 5 concentration is evaluated',
  () => {
    const analysis =
      analyzeHolderConcentration(
        sampleHolders,
        '1000000000'
      );

    assert.equal(
      analysis.top5Percent,
      100
    );
  }
);

test(
  'holder count is tracked',
  () => {
    const analysis =
      analyzeHolderConcentration(
        sampleHolders,
        '1000000000'
      );

    assert.equal(
      analysis.holderCount,
      5
    );
  }
);