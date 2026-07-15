import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessLpSafety,
} from '../sniper/lp-safety.js';

test(
  'burned LP is safe',
  () => {
    const result = assessLpSafety({
      isLpBurned: true,
      lpMintAuthority: null,
      lpFreezeAuthority: null,
    });

    assert.equal(result.lpBurned, true);
    assert.equal(
      result.lpAuthorityRenounced,
      true
    );
    assert.equal(result.reasons.length, 0);
  }
);

test(
  'locked LP is safe',
  () => {
    const result = assessLpSafety({
      isLpLocked: true,
      lpMintAuthority: 'someAuthority',
    });

    assert.equal(result.lpLocked, true);
    assert.equal(result.reasons.length, 0);
  }
);

test(
  'unlocked LP with owner triggers warning',
  () => {
    const result = assessLpSafety({
      lpOwner: 'SomeOwnerAddress',
      lpMintAuthority: 'Auth1',
      lpFreezeAuthority: 'Auth2',
    });

    assert.equal(
      result.suspiciousOwnership,
      true
    );
    assert.ok(result.warnings.length > 0);
  }
);

test(
  'hard reject when burn/lock required but missing',
  () => {
    const result = assessLpSafety(
      {
        lpOwner: 'OwnerAddr',
      },
      { requireBurnOrLock: true }
    );

    assert.equal(result.reasons.length, 1);
    assert.ok(
      result.reasons[0].includes(
        'neither burned nor locked'
      )
    );
  }
);

test(
  'hard reject when authority renounce required',
  () => {
    const result = assessLpSafety(
      {
        lpMintAuthority: 'AuthAddr',
      },
      {
        requireAuthorityRenounced: true,
      }
    );

    assert.equal(result.reasons.length, 1);
    assert.ok(
      result.reasons[0].includes('renounced')
    );
  }
);