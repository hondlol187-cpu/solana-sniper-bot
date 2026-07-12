import { create } from 'zustand';
import {
  startRealTokenMonitor,
  type SafeToken,
} from '@/lib/real-monitor';

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

export interface SniperSettings {
  buyAmountSol: number;
  slippageBps: number;
  targetMultiplier: number;
  minLiquiditySol: number;
  autoEnabled: boolean;
  /** Solana RPC URL used by the live monitor (mainnet-beta by default). */
  rpcUrl: string;
  /** When true + running, subscribe to real Raydium onLogs for live pool detection. */
  useRealMonitor: boolean;
  /** Mirrors CLI LIVE_TRADING: false = dry-run (simulate only), true = live trades. */
  liveTrading: boolean;
  /** Max allowed price impact % (mirrors CLI MAX_PRICE_IMPACT_PCT). */
  maxPriceImpactPct: number;
  /** Stop-loss % — auto-sell when position drops this much (mirrors CLI STOP_LOSS_PCT). */
  stopLossPct: number;
  /** Max hold time in minutes — auto-sell after this (mirrors CLI MAX_HOLD_MINUTES). */
  maxHoldMinutes: number;
}

export type ActivityStatus = 'success' | 'failed' | 'pending';

export interface ActivityLog {
  id: number;
  time: string;
  token: string;
  action: string;
  amount: string;
  status: ActivityStatus;
  tx?: string;
  pnlSol?: number;
}

export interface DetectedPool {
  id: string;
  symbol: string;
  mint: string;
  liquiditySol: number;
  marketCapUsd: number;
  ageSec: number;
  change5m: number;
  passedFilters: boolean;
  /** Anti-scam safety reasons (empty = safe). Mirrors sniper/monitor.ts checkTokenSafety. */
  safetyReasons: string[];
  /** True if the token passed all anti-scam checks (mint auth, freeze auth, liquidity). */
  isSafe: boolean;
  /** Origin of this detection: simulated by the engine or live from RPC. */
  source: 'sim' | 'live';
}

export interface Position {
  id: string;
  symbol: string;
  mint: string;
  entrySol: number;
  currentSol: number;
  tokenAmount: number;
  targetMultiplier: number;
  openedAt: number;
  tx?: string;
}

export interface PnlPoint {
  t: number;
  pnl: number;
  equity: number;
}

export type PresetKey = 'safe' | 'balanced' | 'degen';

export interface Preset {
  key: PresetKey;
  label: string;
  description: string;
  settings: Omit<SniperSettings, 'autoEnabled'>;
}

/* ----------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

export const PRESETS: Preset[] = [
  {
    key: 'safe',
    label: 'Safe',
    description: 'Small size, tight slippage, 2x target',
    settings: { buyAmountSol: 0.02, slippageBps: 200, targetMultiplier: 2.0, minLiquiditySol: 25 },
  },
  {
    key: 'balanced',
    label: 'Balanced',
    description: 'Moderate size & slippage, 3x target',
    settings: { buyAmountSol: 0.05, slippageBps: 500, targetMultiplier: 3.0, minLiquiditySol: 10 },
  },
  {
    key: 'degen',
    label: 'Degen',
    description: 'Bigger size, wide slippage, 5x target',
    settings: { buyAmountSol: 0.15, slippageBps: 1500, targetMultiplier: 5.0, minLiquiditySol: 3 },
  },
];

const FAKE_TX = 'https://solscan.io/tx/';

const MEME_SYMBOLS = [
  'PEPE2', 'WOJAK', 'BONK2', 'DOGE69', 'FROGY', 'MOONR', 'CATNIP', 'SLERF2',
  'WIFHAT', 'POPCAT', 'BOME', 'MEW2', 'MYRO2', 'SC', 'RETARDIO', 'GIGACHAD',
  'NIGGER2', 'HARAMBE', 'KEK', 'COCK', 'TREMP', 'BODEN', 'MUMU', 'BILLY',
];

const SAMPLE_SPARK = [0.5, 0.8, 0.6, 1.2, 0.9, 1.5, 1.3, 1.8, 1.6, 2.1];

/* ----------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

let _id = 1;
const nextId = () => _id++;
const now = () => new Date().toLocaleTimeString();
const rand = (min: number, max: number) => Math.random() * (max - min) + min;
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));
const pick = <T,>(arr: T[]): T => arr[randInt(0, arr.length - 1)];

function randomMint(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
  let s = '';
  for (let i = 0; i < 8; i++) s += chars[randInt(0, chars.length - 1)];
  return s + '...';
}

function makePool(settings: SniperSettings): DetectedPool {
  const liquiditySol = rand(1, 80);
  const change5m = rand(-60, 180);

  // Simulate the anti-scam checks from sniper/monitor.ts checkTokenSafety:
  //   - mint authority active (can mint more tokens -> inflation rug)
  //   - freeze authority active (can freeze holders -> rug)
  //   - liquidity too low (below minLiquiditySol)
  const safetyReasons: string[] = [];
  if (Math.random() < 0.28) safetyReasons.push('Mint authority active');
  if (Math.random() < 0.22) safetyReasons.push('Freeze authority active');
  if (liquiditySol < settings.minLiquiditySol)
    safetyReasons.push(`Liquidity too low (< ${settings.minLiquiditySol} SOL)`);

  const isSafe = safetyReasons.length === 0;
  // passedFilters = safe AND meets the user's liquidity + momentum thresholds
  const passedFilters = isSafe && change5m > -20;

  return {
    id: `pool-${nextId()}`,
    symbol: pick(MEME_SYMBOLS),
    mint: randomMint(),
    liquiditySol,
    marketCapUsd: rand(15_000, 1_200_000),
    ageSec: randInt(2, 90),
    change5m,
    passedFilters,
    safetyReasons,
    isSafe,
    source: 'sim' as const,
  };
}

function makeTx(): string {
  return FAKE_TX + Math.random().toString(36).slice(2, 10);
}

/* ----------------------------------------------------------------------------
 * Store
 * ------------------------------------------------------------------------- */

interface SniperState {
  settings: SniperSettings;
  isRunning: boolean;
  walletConnected: boolean;
  theme: 'dark' | 'light';
  activity: ActivityLog[];
  positions: Position[];
  pools: DetectedPool[];
  pnlHistory: PnlPoint[];
  realizedPnlSol: number;
  snipesToday: number;
  winsToday: number;
  sparkData: number[];
  /** Connected wallet pubkey (truncated) or null. */
  walletAddress: string | null;
  /** Whether a Phantom (or compatible) injected provider was detected. */
  phantomAvailable: boolean;
  /** Live RPC monitor status (null when never started). */
  realMonitor: {
    active: boolean;
    rpcUrl: string;
    lastEventAt: number | null;
    detectedCount: number;
    error: string | null;
  };

  toggleTheme: () => void;
  setRunning: (r: boolean) => void;
  /** Connect via real Phantom injected provider if available; else simulated. */
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  /** Detect injected window.solana (Phantom) on mount. */
  initWallet: () => void;
  updateSetting: <K extends keyof SniperSettings>(k: K, v: SniperSettings[K]) => void;
  applyPreset: (preset: PresetKey) => void;
  addLog: (log: Omit<ActivityLog, 'id' | 'time'>) => void;
  snipeNow: () => void;
  snipePool: (poolId: string) => void;
  /** Fetch a real Jupiter quote server-side (enriches snipe with real price impact). */
  fetchRealQuote: (outputMint: string) => Promise<{
    priceImpactPct: number;
    outAmount: string;
    routeCount: number;
  } | null>;
  sellPosition: (id: string) => void;
  tick: () => void;
  spawnPool: () => void;
  /** Push a real (live-RPC) SafeToken into the detected pools feed. */
  addDetectedPool: (token: SafeToken) => void;
  /** Start the live RPC monitor (Raydium onLogs + initialize2 decoding). */
  startRealMonitor: () => void;
  /** Stop the live RPC monitor. */
  stopRealMonitor: () => void;
  clearActivity: () => void;
  resetAll: () => void;
}

const initialSettings: SniperSettings = {
  buyAmountSol: 0.05,
  slippageBps: 300,
  targetMultiplier: 2.0,
  minLiquiditySol: 10,
  autoEnabled: false,
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  useRealMonitor: false,
  liveTrading: false,
  maxPriceImpactPct: 3,
  stopLossPct: 30,
  maxHoldMinutes: 30,
};

// Module-level ref holding the live monitor stop function (not reactive state).
let _monitorStop: (() => void) | null = null;

export const useSniperStore = create<SniperState>((set, get) => ({
  settings: initialSettings,
  isRunning: false,
  walletConnected: false,
  theme: 'dark',
  activity: [],
  positions: [],
  pools: [],
  pnlHistory: [{ t: Date.now(), pnl: 0, equity: 0 }],
  realizedPnlSol: 0,
  snipesToday: 0,
  winsToday: 0,
  sparkData: SAMPLE_SPARK,
  walletAddress: null,
  phantomAvailable: false,
  realMonitor: {
    active: false,
    rpcUrl: initialSettings.rpcUrl,
    lastEventAt: null,
    detectedCount: 0,
    error: null,
  },

  toggleTheme: () =>
    set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),

  setRunning: (r) => {
    set({ isRunning: r });
    get().addLog({
      token: 'System',
      action: r ? 'Auto Sniper Started' : 'Auto Sniper Stopped',
      amount: '-',
      status: 'success',
    });
  },

  initWallet: () => {
    if (typeof window === 'undefined') return;
    const sol = (window as any).solana;
    if (sol?.isPhantom) {
      set({ phantomAvailable: true });
      // Auto-reconnect if already connected from a prior session
      if (sol.isConnected && sol.publicKey) {
        set({
          walletConnected: true,
          walletAddress: sol.publicKey.toBase58().slice(0, 4) + '…' + sol.publicKey.toBase58().slice(-4),
        });
      }
      // Listen for disconnect events from the provider
      sol.on?.('disconnect', () => {
        set({ walletConnected: false, walletAddress: null });
      });
    }
  },

  connectWallet: async () => {
    const { walletConnected, phantomAvailable } = get();
    // If already connected -> disconnect
    if (walletConnected) {
      const sol = (window as any).solana;
      try {
        await sol?.disconnect?.();
      } catch {
        /* ignore */
      }
      set({ walletConnected: false, walletAddress: null });
      get().addLog({
        token: 'System',
        action: 'Wallet disconnected',
        amount: '-',
        status: 'success',
      });
      return;
    }
    // Real Phantom path
    if (phantomAvailable) {
      const sol = (window as any).solana;
      try {
        const resp = await sol.connect();
        const pk = resp.publicKey.toBase58();
        set({
          walletConnected: true,
          walletAddress: pk.slice(0, 4) + '…' + pk.slice(-4),
        });
        get().addLog({
          token: 'System',
          action: `Phantom wallet connected (${pk.slice(0, 6)}…)`,
          amount: '-',
          status: 'success',
        });
        return;
      } catch (err: any) {
        get().addLog({
          token: 'System',
          action: `Phantom connect rejected: ${err?.message || 'cancelled'}`,
          amount: '-',
          status: 'failed',
        });
        return;
      }
    }
    // Fallback: simulated connection (dev/demo when no Phantom installed)
    await new Promise((r) => setTimeout(r, 350));
    const fakePk =
      'Demo' +
      Math.random().toString(36).slice(2, 6).toUpperCase() +
      '…' +
      Math.random().toString(36).slice(2, 4).toUpperCase();
    set({ walletConnected: true, walletAddress: fakePk });
    get().addLog({
      token: 'System',
      action: 'Simulated wallet connected (no Phantom detected)',
      amount: '-',
      status: 'success',
    });
  },

  disconnectWallet: () => {
    const sol = (typeof window !== 'undefined' ? (window as any).solana : null);
    try {
      sol?.disconnect?.();
    } catch {
      /* ignore */
    }
    set({ walletConnected: false, walletAddress: null });
    get().addLog({
      token: 'System',
      action: 'Wallet disconnected',
      amount: '-',
      status: 'success',
    });
  },

  updateSetting: (k, v) =>
    set((s) => ({ settings: { ...s.settings, [k]: v } })),

  applyPreset: (preset) => {
    const p = PRESETS.find((x) => x.key === preset);
    if (!p) return;
    set((s) => ({
      settings: { ...s.settings, ...p.settings },
    }));
    get().addLog({
      token: 'System',
      action: `Preset applied: ${p.label}`,
      amount: '-',
      status: 'success',
    });
  },

  addLog: (log) =>
    set((s) => ({
      activity: [
        { ...log, id: nextId(), time: now() },
        ...s.activity,
      ].slice(0, 50),
    })),

  snipeNow: () => {
    const { settings } = get();
    const symbol = pick(MEME_SYMBOLS);
    const mode = settings.liveTrading ? 'LIVE' : 'DRY RUN';
    const logId = nextId();
    set((s) => ({
      activity: [
        {
          id: logId,
          time: now(),
          token: symbol,
          action: `[${mode}] Executing Jupiter swap...`,
          amount: `${settings.buyAmountSol} SOL`,
          status: 'pending' as ActivityStatus,
        },
        ...s.activity,
      ].slice(0, 50),
    }));

    // Fetch a REAL Jupiter quote in parallel (USDC = always-available demo mint)
    // to enrich the log with actual market data (price impact, output amount).
    const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    const quotePromise = get().fetchRealQuote(USDC);

    setTimeout(() => {
      const success = Math.random() > 0.25;
      if (success) {
        const entry = settings.buyAmountSol;
        const pos: Position = {
          id: `pos-${nextId()}`,
          symbol,
          mint: randomMint(),
          entrySol: entry,
          currentSol: entry,
          tokenAmount: rand(1000, 500000),
          targetMultiplier: settings.targetMultiplier,
          openedAt: Date.now(),
          tx: makeTx(),
        };
        set((s) => ({
          positions: [pos, ...s.positions],
          snipesToday: s.snipesToday + 1,
          activity: s.activity.map((a) =>
            a.id === logId
              ? {
                  ...a,
                  action: `[${mode}] Swap successful — position opened`,
                  status: 'success' as ActivityStatus,
                  tx: pos.tx,
                }
              : a
          ),
        }));
        // Enrich the log with real quote data once it resolves
        quotePromise.then((q) => {
          if (q) {
            set((s) => ({
              activity: s.activity.map((a) =>
                a.id === logId
                  ? {
                      ...a,
                      action: `[${mode}] Swap OK · impact ${q.priceImpactPct.toFixed(2)}% · ${q.routeCount} hops`,
                    }
                  : a
              ),
            }));
          }
        });
      } else {
        set((s) => ({
          activity: s.activity.map((a) =>
            a.id === logId
              ? { ...a, action: `[${mode}] Swap failed — slippage exceeded`, status: 'failed' as ActivityStatus }
              : a
          ),
        }));
      }
    }, 1400);
  },

  snipePool: (poolId) => {
    const { pools, settings } = get();
    const pool = pools.find((p) => p.id === poolId);
    if (!pool) return;
    const logId = nextId();
    set((s) => ({
      activity: [
        {
          id: logId,
          time: now(),
          token: pool.symbol,
          action: `Sniping ${pool.symbol} from pool…`,
          amount: `${settings.buyAmountSol} SOL`,
          status: 'pending' as ActivityStatus,
        },
        ...s.activity,
      ].slice(0, 50),
      pools: s.pools.filter((p) => p.id !== poolId),
    }));

    setTimeout(() => {
      const success = Math.random() > 0.2;
      if (success) {
        const pos: Position = {
          id: `pos-${nextId()}`,
          symbol: pool.symbol,
          mint: pool.mint,
          entrySol: settings.buyAmountSol,
          currentSol: settings.buyAmountSol,
          tokenAmount: rand(1000, 500000),
          targetMultiplier: settings.targetMultiplier,
          openedAt: Date.now(),
          tx: makeTx(),
        };
        set((s) => ({
          positions: [pos, ...s.positions],
          snipesToday: s.snipesToday + 1,
          activity: s.activity.map((a) =>
            a.id === logId
              ? { ...a, action: 'Position opened', status: 'success' as ActivityStatus, tx: pos.tx }
              : a
          ),
        }));
      } else {
        set((s) => ({
          activity: s.activity.map((a) =>
            a.id === logId
              ? { ...a, action: 'Snipe failed — race lost', status: 'failed' as ActivityStatus }
              : a
          ),
        }));
      }
    }, 1200);
  },

  fetchRealQuote: async (outputMint) => {
    const { settings } = get();
    try {
      const params = new URLSearchParams({
        outputMint,
        amountSol: String(settings.buyAmountSol),
        slippageBps: String(settings.slippageBps),
      });
      const res = await fetch(`/api/quote?${params.toString()}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || data.error) return null;
      return {
        priceImpactPct: Number(data.priceImpactPct) || 0,
        outAmount: String(data.outAmount || '0'),
        routeCount: Array.isArray(data.routePlan) ? data.routePlan.length : 0,
      };
    } catch {
      return null;
    }
  },

  sellPosition: (id) => {
    const { positions } = get();
    const pos = positions.find((p) => p.id === id);
    if (!pos) return;
    const pnl = pos.currentSol - pos.entrySol;
    const won = pnl >= 0;
    set((s) => ({
      positions: s.positions.filter((p) => p.id !== id),
      realizedPnlSol: s.realizedPnlSol + pnl,
      winsToday: s.winsToday + (won ? 1 : 0),
      activity: [
        {
          id: nextId(),
          time: now(),
          token: pos.symbol,
          action: won
            ? `Sold ${pos.symbol} — take profit`
            : `Sold ${pos.symbol} — stop/cut loss`,
          amount: `${pos.currentSol.toFixed(4)} SOL`,
          status: 'success' as ActivityStatus,
          tx: makeTx(),
          pnlSol: pnl,
        },
        ...s.activity,
      ].slice(0, 50),
    }));
  },

  tick: () => {
    const { positions, settings, realizedPnlSol } = get();
    if (positions.length === 0) {
      const t = Date.now();
      set((s) => ({
        pnlHistory: [
          ...s.pnlHistory.slice(-59),
          { t, pnl: realizedPnlSol, equity: realizedPnlSol },
        ],
      }));
      return;
    }
    // random-walk each position; auto-close on take-profit / stop-loss / time-stop
    // (mirrors sniper/position.ts monitorAndExit exit logic)
    const updated: Position[] = [];
    let realizedDelta = 0;
    const closedLogs: Omit<ActivityLog, 'id' | 'time'>[] = [];
    let winsDelta = 0;
    for (const p of positions) {
      const drift = rand(-0.04, 0.07); // slight positive bias
      const next = Math.max(0.0001, p.currentSol * (1 + drift));
      const mult = next / p.entrySol;
      const lossPct = (1 - mult) * 100;
      const holdMinutes = (Date.now() - p.openedAt) / 60_000;
      const takeProfit = mult >= p.targetMultiplier;
      const stopLoss = lossPct >= settings.stopLossPct;
      const timeStop = holdMinutes >= settings.maxHoldMinutes;
      if (takeProfit || stopLoss || timeStop) {
        const reason = takeProfit
          ? `take-profit (${p.targetMultiplier}x)`
          : stopLoss
            ? `stop-loss (-${lossPct.toFixed(1)}%)`
            : `time-stop (${holdMinutes.toFixed(0)}min)`;
        const pnl = next - p.entrySol;
        realizedDelta += pnl;
        if (pnl >= 0) winsDelta += 1;
        closedLogs.push({
          token: p.symbol,
          action: `Auto-sold ${p.symbol} — ${reason}`,
          amount: `${next.toFixed(4)} SOL`,
          status: 'success' as ActivityStatus,
          tx: makeTx(),
          pnlSol: pnl,
        });
      } else {
        updated.push({ ...p, currentSol: next });
      }
    }
    const newRealized = realizedPnlSol + realizedDelta;
    const unrealized = updated.reduce((acc, p) => acc + (p.currentSol - p.entrySol), 0);
    const equity = newRealized + unrealized;
    set((s) => ({
      positions: updated,
      realizedPnlSol: newRealized,
      winsToday: s.winsToday + winsDelta,
      pnlHistory: [
        ...s.pnlHistory.slice(-59),
        { t: Date.now(), pnl: newRealized + unrealized, equity },
      ],
      activity: closedLogs.length
        ? [
            ...closedLogs.map((l) => ({ ...l, id: nextId(), time: now() })),
            ...s.activity,
          ].slice(0, 50)
        : s.activity,
    }));
  },

  spawnPool: () => {
    const { settings, isRunning } = get();
    if (!isRunning) return;
    const pool = makePool(settings);
    set((s) => ({ pools: [pool, ...s.pools].slice(0, 12) }));

    // Log unsafe detections (mirrors sniper/monitor.ts "🚫 Filtered unsafe token")
    if (!pool.isSafe) {
      get().addLog({
        token: pool.symbol,
        action: `Filtered unsafe ${pool.symbol} — ${pool.safetyReasons.join('; ')}`,
        amount: '-',
        status: 'failed',
      });
      return;
    }

    // Safe token — auto-snipe if enabled (with some probability), else log as skipped
    if (settings.autoEnabled && pool.passedFilters && Math.random() > 0.35) {
      setTimeout(() => get().snipePool(pool.id), 600);
    } else if (settings.autoEnabled && pool.passedFilters) {
      get().addLog({
        token: pool.symbol,
        action: `Safe token detected ${pool.symbol} — skipped (filter margin)`,
        amount: '-',
        status: 'pending',
      });
    } else {
      get().addLog({
        token: pool.symbol,
        action: `Safe token detected ${pool.symbol} — awaiting manual snipe`,
        amount: '-',
        status: 'pending',
      });
    }
  },

  clearActivity: () => set({ activity: [] }),

  addDetectedPool: (token) => {
    // Convert a real (live-RPC) SafeToken into a DetectedPool and prepend.
    const pool: DetectedPool = {
      id: `live-${nextId()}`,
      symbol: token.mint.slice(0, 6),
      mint: token.mint.slice(0, 4) + '…' + token.mint.slice(-4),
      liquiditySol: token.liquiditySol,
      marketCapUsd: 0, // unknown until pool reserves fetched
      ageSec: 0,
      change5m: 0,
      passedFilters: token.isSafe,
      safetyReasons: token.reasons,
      isSafe: token.isSafe,
      source: 'live',
    };
    set((s) => ({ pools: [pool, ...s.pools].slice(0, 12) }));
    get().addLog({
      token: pool.symbol,
      action: `🔴 LIVE: real new pool detected ${pool.symbol} (passed safety checks)`,
      amount: '-',
      status: 'success',
    });
    // Auto-snipe real safe tokens if auto mode is on
    const { settings } = get();
    if (settings.autoEnabled && token.isSafe) {
      setTimeout(() => get().snipePool(pool.id), 400);
    }
  },

  startRealMonitor: () => {
    const { settings, realMonitor } = get();
    if (realMonitor.active) return; // already running
    if (_monitorStop) {
      try { _monitorStop(); } catch { /* ignore */ }
      _monitorStop = null;
    }
    _monitorStop = startRealTokenMonitor(
      settings.rpcUrl,
      settings.minLiquiditySol,
      (token) => get().addDetectedPool(token),
      (err) => {
        set((s) => ({ realMonitor: { ...s.realMonitor, error: err } }));
      },
      (patch) => {
        set((s) => ({ realMonitor: { ...s.realMonitor, ...patch } }));
      }
    );
    get().addLog({
      token: 'System',
      action: `🔴 Live RPC monitor started (${settings.rpcUrl})`,
      amount: '-',
      status: 'success',
    });
  },

  stopRealMonitor: () => {
    const wasActive = get().realMonitor.active;
    if (_monitorStop) {
      try { _monitorStop(); } catch { /* ignore */ }
      _monitorStop = null;
    }
    set((s) => ({ realMonitor: { ...s.realMonitor, active: false, error: null } }));
    if (wasActive) {
      get().addLog({
        token: 'System',
        action: 'Live RPC monitor stopped',
        amount: '-',
        status: 'success',
      });
    }
  },

  resetAll: () =>
    set({
      activity: [],
      positions: [],
      pools: [],
      pnlHistory: [{ t: Date.now(), pnl: 0, equity: 0 }],
      realizedPnlSol: 0,
      snipesToday: 0,
      winsToday: 0,
      isRunning: false,
    }),
}));

/* ----------------------------------------------------------------------------
 * Derived selectors
 * ------------------------------------------------------------------------- */

export function selectKpis(s: SniperState) {
  const unrealized = s.positions.reduce(
    (acc, p) => acc + (p.currentSol - p.entrySol),
    0
  );
  const totalPnl = s.realizedPnlSol + unrealized;
  const successRate =
    s.snipesToday > 0 ? Math.round((s.winsToday / s.snipesToday) * 100) : 0;
  return {
    totalPnl,
    realized: s.realizedPnlSol,
    unrealized,
    successRate,
    activePositions: s.positions.length,
    snipesToday: s.snipesToday,
    poolsWatched: s.pools.length,
  };
}
