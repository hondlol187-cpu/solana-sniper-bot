import assert from 'node:assert/strict';
import test from 'node:test';

test(
  'shadow mode CLI refuses LIVE_TRADING=true',
  async () => {
    process.env.SHADOW_MODE = 'true';
    process.env.LIVE_TRADING = 'true';
    process.env.RPC_URL = 'https://api.devnet.solana.com';
    process.env.OUTPUT_MINT = 'So11111111111111111111111111111111';
    process.env.WALLET_PUBLIC_KEY = '11111111111111111111111111111111';

    try {
      const { spawnSync } = await import('node:child_process');
      const { join, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');

      const __filename = (await import('node:url')).fileURLToPath(import.meta.url);
      const __dirname = (await import('node:path')).dirname(__filename);
      const PROJECT_ROOT = join(__dirname, '..');

      const result = spawnSync(
        'bunx',
        ['tsx', 'sniper/run-shadow-mode.ts', '--duration-minutes', '0'],
        { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 15_000, env: { ...process.env } }
      );

      assert.ok(
        result.stderr?.includes('LIVE_TRADING') || result.stdout?.includes('LIVE_TRADING') || result.status !== 0,
        `Should refuse LIVE_TRADING=true. status=${result.status}`
      );
    } finally {
      delete process.env.LIVE_TRADING;
      delete process.env.SHADOW_MODE;
      delete process.env.RPC_URL;
      delete process.env.OUTPUT_MINT;
      delete process.env.WALLET_PUBLIC_KEY;
    }
  }
);

test(
  'shadow mode CLI refuses ENABLE_MAINNET_EXECUTION=true',
  async () => {
    process.env.SHADOW_MODE = 'true';
    process.env.ENABLE_MAINNET_EXECUTION = 'true';
    process.env.RPC_URL = 'https://api.devnet.solana.com';
    process.env.OUTPUT_MINT = 'So11111111111111111111111111111111';
    process.env.WALLET_PUBLIC_KEY = '11111111111111111111111111111111';

    try {
      const { spawnSync } = await import('node:child_process');
      const { join, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');

      const __filename = (await import('node:url')).fileURLToPath(import.meta.url);
      const __dirname = (await import('node:path')).dirname(__filename);
      const PROJECT_ROOT = join(__dirname, '..');

      const result = spawnSync(
        'bunx',
        ['tsx', 'sniper/run-shadow-mode.ts', '--duration-minutes', '0'],
        { cwd: PROJECT_ROOT, encoding: 'utf8', timeout: 15_000, env: { ...process.env } }
      );

      assert.ok(
        result.stderr?.includes('ENABLE_MAINNET_EXECUTION') || result.stdout?.includes('ENABLE_MAINNET_EXECUTION') || result.status !== 0,
        `Should refuse ENABLE_MAINNET_EXECUTION=true. status=${result.status}`
      );
    } finally {
      delete process.env.ENABLE_MAINNET_EXECUTION;
      delete process.env.SHADOW_MODE;
      delete process.env.RPC_URL;
      delete process.env.OUTPUT_MINT;
      delete process.env.WALLET_PUBLIC_KEY;
    }
  }
);