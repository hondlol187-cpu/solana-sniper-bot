import 'dotenv/config';

import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

export interface BotConfig {
  rpcUrl: string;
  keypair: Keypair;
  jitoTipLamports: number;
  buyAmountSol: number;
  slippageBps: number;
  targetMultiplier: number;
  minLiquiditySol: number;
}

const privateKeyBase58 = process.env.PRIVATE_KEY;
if (!privateKeyBase58) {
  console.error('❌ PRIVATE_KEY is required in .env file');
  process.exit(1);
}

const secretKey = bs58.decode(privateKeyBase58);
const keypair = Keypair.fromSecretKey(secretKey);

export const config: BotConfig = {
  rpcUrl: process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
  keypair,
  jitoTipLamports: parseInt(process.env.JITO_TIP || '100000'),
  buyAmountSol: parseFloat(process.env.BUY_AMOUNT_SOL || '0.05'),
  slippageBps: parseInt(process.env.SLIPPAGE_BPS || '300'),
  targetMultiplier: parseFloat(process.env.TARGET_MULTIPLIER || '2.0'),
  minLiquiditySol: parseFloat(process.env.MIN_LIQUIDITY_SOL || '10'),
};

console.log('✅ Config loaded');
console.log(`Wallet: ${keypair.publicKey.toBase58()}`);
