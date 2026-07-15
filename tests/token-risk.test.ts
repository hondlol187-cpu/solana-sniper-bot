import assert from 'node:assert/strict';
import test from 'node:test';

import { assessTokenRisk } from '../sniper/token-risk.js';
import { clearDeployerHistory, flagRugLinked, recordLaunch } from '../sniper/deployer-history.js';
import type { HolderEntry } from '../sniper/token-holders.js';

const safeHolders: HolderEntry[] = Array.from(
  { length: 20 },
  (_, i) => ({
    address: `SafeHolder${i}`.padEnd(44, 'A'),
    amount: '50000000',
    percent: 5,
  })
);

test(
  'token risk: safe distribution passes',
  () => {
    clearDeployerHistory();
    const report = assessTokenRisk({
      mintAddress: 'SafeMint',
      holders: safeHolders,
      totalSupply: '1000000000',
      lpParams: {
        isLpBurned: true,
        lpMintAuthority: null,
        lpFreezeAuthority: null,
      },
    });

    assert.equal(report.safe, true);
    assert.equal(report.hardReject, false);
    assert.equal(report.reasons.length, 0);
  }
);

test(
  'token risk: concentrated holders hard reject',
  () => {
    clearDeployerHistory();
    const concentratedHolders: HolderEntry[] = [
      { address: 'Whale'.padEnd(44, 'W'), amount: '800000000', percent: 80 },
      { address: 'Other'.padEnd(44, 'O'), amount: '200000000', percent: 20 },
    ];

    const report = assessTokenRisk({
      mintAddress: 'ConcMint',
      holders: concentratedHolders,
      totalSupply: '1000000000',
      lpParams: {
        isLpBurned: true,
        lpMintAuthority: null,
        lpFreezeAuthority: null,
      },
    });

    assert.equal(report.hardReject, true);
    assert.equal(report.safe, false);
    assert.ok(report.metrics.topHolderPercent >= 80);
  }
);

test(
  'token risk: suspicious deployer escalates',
  () => {
    clearDeployerHistory();
    const deployer = 'BadDeployer'.padEnd(44, 'D');

    recordLaunch(deployer);
    flagRugLinked(deployer);

    const report = assessTokenRisk({
      mintAddress: 'RiskyMint',
      creatorAddress: deployer,
      holders: safeHolders,
      totalSupply: '1000000000',
      lpParams: {
        isLpBurned: true,
        lpMintAuthority: null,
        lpFreezeAuthority: null,
      },
    });

    assert.equal(report.hardReject, true);
    assert.equal(
      report.metrics.knownDeployerRisk,
      'high'
    );
  }
);

test(
  'token risk: LP status affects decisioning',
  () => {
    clearDeployerHistory();
    const report = assessTokenRisk({
      mintAddress: 'LpMint',
      holders: safeHolders,
      totalSupply: '1000000000',
      lpParams: {
        lpOwner: 'SomeOwner',
        lpMintAuthority: 'Auth',
        lpFreezeAuthority: 'Freeze',
      },
      mintSafetyReasons: ['Mint authority is active'],
    });

    assert.equal(report.hardReject, true);
    assert.ok(report.reasons.length > 0);
  }
);

test(
  'token risk: hard reject vs warning thresholds',
  () => {
    clearDeployerHistory();
    const report = assessTokenRisk({
      mintAddress: 'WarnMint',
      holders: safeHolders,
      totalSupply: '1000000000',
      lpParams: {
        lpOwner: 'LpOwner',
      },
    });

    assert.equal(report.hardReject, false);
    assert.ok(report.warnings.length > 0);
  }
);

test(
  'token risk: stable output formatting',
  () => {
    clearDeployerHistory();
    const input = {
      mintAddress: 'FmtMint',
      holders: safeHolders,
      totalSupply: '1000000000',
      lpParams: {
        isLpBurned: true,
        lpMintAuthority: null,
        lpFreezeAuthority: null,
      },
    };

    const report1 = assessTokenRisk(input);
    const report2 = assessTokenRisk(input);

    assert.deepEqual(report1, report2);
    assert.equal(typeof report1.score, 'number');
    assert.ok(report1.score >= 0 && report1.score <= 100);
  }
);