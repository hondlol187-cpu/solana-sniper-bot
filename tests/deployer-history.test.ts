import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recordLaunch,
  recordRejection,
  flagRugLinked,
  assessDeployerRisk,
  clearDeployerHistory,
} from '../sniper/deployer-history.js';

test(
  'unknown deployer is low risk',
  () => {
    clearDeployerHistory();
    const result = assessDeployerRisk(
      'UnknownDeployerAddr'
    );

    assert.equal(result.level, 'low');
    assert.equal(result.reasons.length, 0);
  }
);

test(
  'suspicious deployer escalation via rug flag',
  () => {
    clearDeployerHistory();
    const addr = 'RugDeployer'.padEnd(44, 'X');

    recordLaunch(addr);
    flagRugLinked(addr);

    const result = assessDeployerRisk(addr);

    assert.equal(result.level, 'high');
    assert.ok(
      result.reasons.some((r) =>
        r.includes('rug')
      )
    );
  }
);

test(
  'excessive launch churn is medium risk',
  () => {
    clearDeployerHistory();
    const addr = 'ChurnDeployer'.padEnd(44, 'Y');

    for (let i = 0; i < 6; i++) {
      recordLaunch(addr);
    }

    const result = assessDeployerRisk(addr);

    assert.ok(
      result.level === 'medium' ||
        result.level === 'high'
    );

    assert.ok(
      result.reasons.some((r) =>
        r.includes('churn')
      )
    );
  }
);

test(
  'high rejection ratio escalates risk',
  () => {
    clearDeployerHistory();
    const addr = 'RejectDeployer'.padEnd(44, 'Z');

    for (let i = 0; i < 5; i++) {
      recordLaunch(addr);
      recordRejection(addr);
    }

    const result = assessDeployerRisk(addr);

    assert.equal(result.level, 'high');
    assert.ok(
      result.reasons.some((r) =>
        r.includes('rejection ratio')
      )
    );
  }
);