import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'rejects plan creation when route assessment fails',
  async () => {
    const {
      assertPlanCanBeWritten,
    } = await import(
      '../sniper/prepare-approved-core.js'
    );

    assert.throws(
      () =>
        assertPlanCanBeWritten(
          {
            ok: false,
            reasons: ['bad route'],
            hopCount: 2,
            labels: [],
            ammKeys: [],
          } as any,
          {
            ok: true,
            reasons: [],
            quoteAgeMs: 1000,
            liquidityDropPct: 0,
          } as any
        ),
      /route does not bind/
    );
  }
);

test(
  'rejects plan creation when approval assessment fails',
  async () => {
    const {
      assertPlanCanBeWritten,
    } = await import(
      '../sniper/prepare-approved-core.js'
    );

    assert.throws(
      () =>
        assertPlanCanBeWritten(
          {
            ok: true,
            reasons: [],
            hopCount: 1,
            labels: ['Raydium'],
            ammKeys: ['POOL_1'],
          } as any,
          {
            ok: false,
            reasons: ['quote too old'],
            quoteAgeMs: 999999,
            liquidityDropPct: 0,
          } as any
        ),
      /policy checks failed/
    );
  }
);

test(
  'allows plan creation only when both assessments pass',
  async () => {
    const {
      assertPlanCanBeWritten,
    } = await import(
      '../sniper/prepare-approved-core.js'
    );

    assert.doesNotThrow(() =>
      assertPlanCanBeWritten(
        {
          ok: true,
          reasons: [],
          hopCount: 1,
          labels: ['Raydium'],
          ammKeys: ['POOL_1'],
        } as any,
        {
          ok: true,
          reasons: [],
          quoteAgeMs: 1000,
          liquidityDropPct: 0,
        } as any
      )
    );
  }
);

test(
  'route failure takes precedence over approval failure',
  async () => {
    const {
      assertPlanCanBeWritten,
    } = await import(
      '../sniper/prepare-approved-core.js'
    );

    assert.throws(
      () =>
        assertPlanCanBeWritten(
          {
            ok: false,
            reasons: ['bad route'],
            hopCount: 2,
            labels: [],
            ammKeys: [],
          } as any,
          {
            ok: false,
            reasons: ['quote too old'],
            quoteAgeMs: 999999,
            liquidityDropPct: 0,
          } as any
        ),
      /route does not bind/
    );
  }
);

test(
  'error message includes all route reasons',
  async () => {
    const {
      assertPlanCanBeWritten,
    } = await import(
      '../sniper/prepare-approved-core.js'
    );

    assert.throws(
      () =>
        assertPlanCanBeWritten(
          {
            ok: false,
            reasons: [
              'first reason',
              'second reason',
            ],
            hopCount: 0,
            labels: [],
            ammKeys: [],
          } as any,
          {
            ok: true,
            reasons: [],
            quoteAgeMs: 1000,
            liquidityDropPct: 0,
          } as any
        ),
      (error: unknown) => {
        const message =
          error instanceof Error
            ? error.message
            : String(error);

        return (
          message.includes('first reason') &&
          message.includes('second reason')
        );
      }
    );
  }
);
