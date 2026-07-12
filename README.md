# Solana Sniper Bot

**High-Risk Experimental Trading Automation**

This repo now contains a real, working TypeScript Solana trading/sniper bot foundation.

> **⚠️ IMPORTANT WARNINGS — READ CAREFULLY**
> - Cryptocurrency trading, especially sniping new memecoins, is extremely high risk.
> - You can (and statistically likely will) lose all funds used.
> - Never use money you cannot afford to lose completely.
> - Use ONLY a dedicated burner wallet with small amounts.
> - Test everything on devnet first.
> - Never commit your `.env` file or share your private key.
> - The authors and contributors are not responsible for any losses, bugs, or misuse.

## What This Bot Provides (Current State)

- Working CLI-based Solana trading bot
- Reliable swaps via Jupiter aggregator (easy and battle-tested)
- Configurable buy amount, slippage, and basic take-profit logic
- Jito tip support ready for bundles (expandable)
- Strong emphasis on security and responsible use
- Foundation to build true low-latency new token sniping (Pump.fun / Raydium launches)

The original Next.js + shadcn/ui web starter is preserved in case you want to build a web dashboard later.

## Quick Start

```bash
# 1. Clone
git clone https://github.com/hondlol187-cpu/solana-sniper-bot.git
cd solana-sniper-bot

# 2. Install (uses npm + tsx for simplicity)
npm install

# 3. Configure
cp .env.example .env
# Edit .env with your burner wallet private key and RPC

# 4. Run the sniper (example buy)
npm run sniper
```

## Configuration (`.env`)

See `.env.example` for all options and detailed security warnings.

Key settings:
- `PRIVATE_KEY` — Base58 private key of your burner wallet (never commit!)
- `RPC_URL` — Use a fast private RPC (Helius, QuickNode recommended for production)
- `BUY_AMOUNT_SOL`, `SLIPPAGE_BPS`, `TARGET_MULTIPLIER`

## Running the Bot

```bash
npm run sniper
```

By default it demonstrates a swap. Edit `sniper/index.ts` to customize which token to buy or add monitoring logic.

## How to Extend to Real New-Launch Sniping

To turn this into a true sniper for new Pump.fun or Raydium launches:

1. Implement real-time monitoring in `sniper/monitor.ts` using:
   - `connection.onLogs` (simple but higher latency)
   - Yellowstone gRPC / Geyser (best for speed)
2. Detect new pool creation (Raydium `initialize2` or Pump.fun program events)
3. Apply filters (liquidity, authorities, dev wallet, honeypot checks)
4. Build direct buy transaction or use Jupiter for simplicity
5. Send via Jito bundle for MEV protection and priority landing

See comments in the code for starting points. Many public examples exist for Pump.fun and Raydium SDK integration.

## Project Structure

```
.
├── sniper/                # Solana sniper bot (CLI)
│   ├── index.ts           # Entry point — demonstrates a Jupiter swap
│   ├── config.ts          # Loads .env -> Keypair + settings
│   ├── jupiter.ts         # Jupiter v6 quote + swap helpers
│   └── monitor.ts         # Stub for new-pool monitoring (extend this)
├── src/                   # Original Next.js + shadcn/ui web starter
├── prisma/                # Prisma schema (for the web starter)
└── examples/              # Reference snippets
```

## Security & Best Practices

- Always use a fresh burner wallet
- Start with $5–20 buys
- Monitor transactions on Solscan
- Consider running on a low-latency VPS near validators
- Regularly update dependencies
- Audit any code you add, especially transaction building

## License

MIT

Use at your own risk. Trade responsibly.
