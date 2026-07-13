import assert from 'node:assert/strict';
import test from 'node:test';

import bs58 from 'bs58';

import {
  Keypair,
  PartiallyDecodedInstruction,
  PublicKey,
} from '@solana/web3.js';

function configureEnvironment(): void {
  process.env.LIVE_TRADING =
    'false';

  process.env.RPC_URL =
    'https://api.mainnet-beta.solana.com';

  process.env.WALLET_PUBLIC_KEY =
    '11111111111111111111111111111111';

  process.env.OUTPUT_MINT =
    'So11111111111111111111111111111111111111112';

  process.env.AUDIT_FILE =
    `/tmp/sniper-decoder-audit-${process.pid}.jsonl`;
}

function randomKey(): PublicKey {
  return Keypair.generate()
    .publicKey;
}

function createInstruction(
  options: {
    wsolSide?: 'coin' | 'pc';
    tag?: number;
    accountCount?: number;
    initialCoinAmount?: bigint;
    initialPcAmount?: bigint;
  } = {}
): PartiallyDecodedInstruction {
  const {
    wsolSide = 'pc',
    tag = 1,
    accountCount = 21,
    initialCoinAmount = 1_000_000n,
    initialPcAmount =
      10_000_000_000n,
  } = options;

  const accounts =
    Array.from(
      {
        length: accountCount,
      },
      () => randomKey()
    );

  const tokenProgram =
    new PublicKey(
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    );

  const associatedTokenProgram =
    new PublicKey(
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
    );

  const systemProgram =
    new PublicKey(
      '11111111111111111111111111111111'
    );

  const rentSysvar =
    new PublicKey(
      'SysvarRent111111111111111111111111111111111'
    );

  const wrappedSol =
    new PublicKey(
      'So11111111111111111111111111111111111111112'
    );

  if (accounts.length >= 12) {
    accounts[0] = tokenProgram;
    accounts[1] =
      associatedTokenProgram;
    accounts[2] = systemProgram;
    accounts[3] = rentSysvar;

    accounts[8] =
      wsolSide === 'coin'
        ? wrappedSol
        : randomKey();

    accounts[9] =
      wsolSide === 'pc'
        ? wrappedSol
        : randomKey();
  }

  const data = Buffer.alloc(26);

  data[0] = tag;
  data[1] = 254;

  data.writeBigUInt64LE(
    BigInt(
      Math.floor(Date.now() / 1_000)
    ),
    2
  );

  data.writeBigUInt64LE(
    initialPcAmount,
    10
  );

  data.writeBigUInt64LE(
    initialCoinAmount,
    18
  );

  return {
    programId:
      new PublicKey(
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'
      ),

    accounts,

    data: bs58.encode(data),
  };
}

test(
  'decodes WSOL on PC side',
  async () => {
    configureEnvironment();

    const decoder =
      await import(
        '../sniper/raydium-decoder.js'
      );

    const monitor =
      await import(
        '../sniper/monitor.js'
      );

    const instruction =
      createInstruction({
        wsolSide: 'pc',
      });

    const signal = {
      signature: 'test-signature',
      slot: 123,
      programId:
        monitor.RAYDIUM_AMM_V4
          .toBase58(),
      detectedAt:
        new Date().toISOString(),
      validated: false as const,
    };

    const result =
      decoder
        .decodeInitialize2Instruction(
          instruction,
          signal
        );

    assert.ok(result);

    assert.equal(
      result.quoteMint,
      instruction.accounts[9]
        .toBase58()
    );

    assert.equal(
      result.baseMint,
      instruction.accounts[8]
        .toBase58()
    );

    assert.equal(
      result.baseVault,
      instruction.accounts[10]
        .toBase58()
    );

    assert.equal(
      result.quoteVault,
      instruction.accounts[11]
        .toBase58()
    );

    assert.equal(
      result.nonce,
      254
    );

    assert.equal(
      result.initialBaseAmountRaw,
      '1000000'
    );

    assert.equal(
      result.initialQuoteAmountRaw,
      '10000000000'
    );
  }
);

test(
  'normalizes WSOL on coin side',
  async () => {
    configureEnvironment();

    const decoder =
      await import(
        '../sniper/raydium-decoder.js'
      );

    const monitor =
      await import(
        '../sniper/monitor.js'
      );

    const instruction =
      createInstruction({
        wsolSide: 'coin',
      });

    const signal = {
      signature: 'test-signature',
      slot: 123,
      programId:
        monitor.RAYDIUM_AMM_V4
          .toBase58(),
      detectedAt:
        new Date().toISOString(),
      validated: false as const,
    };

    const result =
      decoder
        .decodeInitialize2Instruction(
          instruction,
          signal
        );

    assert.ok(result);

    assert.equal(
      result.quoteMint,
      instruction.accounts[8]
        .toBase58()
    );

    assert.equal(
      result.baseMint,
      instruction.accounts[9]
        .toBase58()
    );

    assert.equal(
      result.baseVault,
      instruction.accounts[11]
        .toBase58()
    );

    assert.equal(
      result.quoteVault,
      instruction.accounts[10]
        .toBase58()
    );
  }
);

test(
  'ignores non-Initialize2 discriminator',
  async () => {
    configureEnvironment();

    const decoder =
      await import(
        '../sniper/raydium-decoder.js'
      );

    const monitor =
      await import(
        '../sniper/monitor.js'
      );

    const instruction =
      createInstruction({
        tag: 3,
      });

    const result =
      decoder
        .decodeInitialize2Instruction(
          instruction,
          {
            signature: 'test',
            slot: 1,
            programId:
              monitor.RAYDIUM_AMM_V4
                .toBase58(),
            detectedAt:
              new Date().toISOString(),
            validated: false,
          }
        );

    assert.equal(result, null);
  }
);

test(
  'rejects incorrect account count',
  async () => {
    configureEnvironment();

    const decoder =
      await import(
        '../sniper/raydium-decoder.js'
      );

    const monitor =
      await import(
        '../sniper/monitor.js'
      );

    const instruction =
      createInstruction({
        accountCount: 20,
      });

    assert.throws(
      () =>
        decoder
          .decodeInitialize2Instruction(
            instruction,
            {
              signature: 'test',
              slot: 1,
              programId:
                monitor
                  .RAYDIUM_AMM_V4
                  .toBase58(),
              detectedAt:
                new Date()
                  .toISOString(),
              validated: false,
            }
          ),
      /expected 21/
    );
  }
);

test(
  'rejects zero initial reserves',
  async () => {
    configureEnvironment();

    const decoder =
      await import(
        '../sniper/raydium-decoder.js'
      );

    const monitor =
      await import(
        '../sniper/monitor.js'
      );

    const instruction =
      createInstruction({
        initialCoinAmount: 0n,
      });

    assert.throws(
      () =>
        decoder
          .decodeInitialize2Instruction(
            instruction,
            {
              signature: 'test',
              slot: 1,
              programId:
                monitor
                  .RAYDIUM_AMM_V4
                  .toBase58(),
              detectedAt:
                new Date()
                  .toISOString(),
              validated: false,
            }
          ),
      /empty initial reserves/
    );
  }
);
