import assert from 'node:assert/strict';
import test from 'node:test';

import {
  unlink,
} from 'node:fs/promises';

function configureEnvironment(): string {
  const suffix =
    `${process.pid}-${Date.now()}`;

  const riskFile =
    `/tmp/sniper-risk-${suffix}.json`;

  process.env.LIVE_TRADING =
    'false';

  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';

  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';

  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';

  process.env.RISK_FILE =
    riskFile;

  process.env.AUDIT_FILE =
    `/tmp/sniper-risk-audit-${suffix}.jsonl`;

  process.env.MAX_DAILY_SPEND_SOL =
    '0.2';

  process.env.MAX_DAILY_TRADES =
    '3';

  process.env.MAX_DAILY_DRAWDOWN_SOL =
    '0.1';

  return riskFile;
}

async function removeFile(
  path: string
): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    const code = (
      error as NodeJS.ErrnoException
    ).code;

    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

test(
  'reservation commit and completion are idempotent',
  async () => {
    const riskFile =
      configureEnvironment();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    const opening =
      1_000_000_000n;

    try {
      const reservation =
        await risk.reserveTrade(
          'TEST_MINT',
          50_000_000n,
          opening
        );

      let state =
        await risk.getRiskState(
          opening
        );

      assert.equal(
        state.reservations.length,
        1
      );

      await risk.commitReservation(
        reservation.id,
        950_000_000n
      );

      await risk.commitReservation(
        reservation.id,
        950_000_000n
      );

      await risk.recordTradeCompleted(
        reservation.id,
        1_010_000_000n
      );

      await risk.recordTradeCompleted(
        reservation.id,
        1_010_000_000n
      );

      state =
        await risk.getRiskState(
          1_010_000_000n
        );

      assert.equal(
        state.reservations.length,
        0
      );

      assert.equal(
        state.spentLamports,
        '50000000'
      );

      assert.equal(
        state.completedTrades,
        1
      );
    } finally {
      await risk
        .deleteRiskFileForTests();

      await removeFile(
        process.env.AUDIT_FILE!
      );

      await removeFile(riskFile);
    }
  }
);

test(
  'rejects projected spend above daily maximum',
  async () => {
    configureEnvironment();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    const opening =
      1_000_000_000n;

    try {
      const first =
        await risk.reserveTrade(
          'MINT_A',
          150_000_000n,
          opening
        );

      await risk.commitReservation(
        first.id,
        950_000_000n
      );

      await assert.rejects(
        () =>
          risk.reserveTrade(
            'MINT_B',
            60_000_000n,
            950_000_000n
          ),
        /Daily spend limit exceeded/
      );

      const state =
        await risk.getRiskState(
          950_000_000n
        );

      assert.match(
        state.haltedReason ?? '',
        /Daily spend limit exceeded/
      );
    } finally {
      await risk
        .deleteRiskFileForTests();

      await removeFile(
        process.env.AUDIT_FILE!
      );
    }
  }
);

test(
  'rejects wallet drawdown above maximum',
  async () => {
    configureEnvironment();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    const opening =
      1_000_000_000n;

    try {
      /*
       * Initialize the day with a 1 SOL opening
       * balance. resetRiskState persists the
       * opening balance to disk so the subsequent
       * reserveTrade can compute drawdown against
       * it. (getRiskState is read-only and would
       * not persist.)
       */
      await risk.resetRiskState(
        opening
      );

      await assert.rejects(
        () =>
          risk.reserveTrade(
            'MINT_DRAWDOWN',
            10_000_000n,
            850_000_000n
          ),
        /Daily drawdown exceeded/
      );
    } finally {
      await risk
        .deleteRiskFileForTests();

      await removeFile(
        process.env.AUDIT_FILE!
      );
    }
  }
);

test(
  'does not reset while reservations exist',
  async () => {
    configureEnvironment();

    const risk =
      await import(
        '../sniper/risk.js'
      );

    const opening =
      1_000_000_000n;

    try {
      await risk.reserveTrade(
        'MINT_RESERVED',
        10_000_000n,
        opening
      );

      await assert.rejects(
        () =>
          risk.resetRiskState(
            opening
          ),
        /reservations exist/
      );
    } finally {
      await risk
        .deleteRiskFileForTests();

      await removeFile(
        process.env.AUDIT_FILE!
      );
    }
  }
);
