import { create } from 'zustand';

/* ----------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------- */

export interface SniperSettings {
  buyAmountSol: number;
  slippageBps: number;
  targetMultiplier: number;
  minLiquiditySol: number;
  autoEnabled: boolean;
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
  const passedFilters =
    liquiditySol >= settings.minLiquiditySol && change5m > -20;
  return {
    id: `pool-${nextId()}`,
    symbol: pick(MEME_SYMBOLS),
    mint: randomMint(),
    liquiditySol,
    marketCapUsd: rand(15_000, 1_200_000),
    ageSec: randInt(2, 90),
    change5m,
    passedFilters,
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

  toggleTheme: () => void;
  setRunning: (r: boolean) => void;
  connectWallet: () => void;
  disconnectWallet: () => void;
  updateSetting: <K extends keyof SniperSettings>(k: K, v: SniperSettings[K]) => void;
  applyPreset: (preset: PresetKey) => void;
  addLog: (log: Omit<ActivityLog, 'id' | 'time'>) => void;
  snipeNow: () => void;
  snipePool: (poolId: string) => void;
  sellPosition: (id: string) => void;
  tick: () => void;
  spawnPool: () => void;
  clearActivity: () => void;
  resetAll: () => void;
}

const initialSettings: SniperSettings = {
  buyAmountSol: 0.05,
  slippageBps: 300,
  targetMultiplier: 2.0,
  minLiquiditySol: 10,
  autoEnabled: false,
};

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

  connectWallet: () => {
    set((s) => ({ walletConnected: !s.walletConnected }));
    get().addLog({
      token: 'System',
      action: !get().walletConnected ? 'Wallet disconnected' : 'Wallet connected',
      amount: '-',
      status: 'success',
    });
  },

  disconnectWallet: () => {
    set({ walletConnected: false });
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
    const logId = nextId();
    set((s) => ({
      activity: [
        {
          id: logId,
          time: now(),
          token: symbol,
          action: 'Executing Jupiter swap...',
          amount: `${settings.buyAmountSol} SOL`,
          status: 'pending' as ActivityStatus,
        },
        ...s.activity,
      ].slice(0, 50),
    }));

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
                  action: 'Swap successful — position opened',
                  status: 'success' as ActivityStatus,
                  tx: pos.tx,
                }
              : a
          ),
        }));
      } else {
        set((s) => ({
          activity: s.activity.map((a) =>
            a.id === logId
              ? { ...a, action: 'Swap failed — slippage exceeded', status: 'failed' as ActivityStatus }
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
    // random-walk each position; auto-close at target
    const updated: Position[] = [];
    let realizedDelta = 0;
    let newlyClosed: { pos: Position; pnl: number } | null = null;
    for (const p of positions) {
      const drift = rand(-0.04, 0.07); // slight positive bias
      const next = Math.max(0.0001, p.currentSol * (1 + drift));
      const mult = next / p.entrySol;
      if (mult >= p.targetMultiplier) {
        // auto take-profit
        newlyClosed = { pos: { ...p, currentSol: next }, pnl: next - p.entrySol };
        realizedDelta += next - p.entrySol;
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
      winsToday: newlyClosed ? s.winsToday + 1 : s.winsToday,
      pnlHistory: [
        ...s.pnlHistory.slice(-59),
        { t: Date.now(), pnl: newRealized + unrealized, equity },
      ],
      activity: newlyClosed
        ? [
            {
              id: nextId(),
              time: now(),
              token: newlyClosed.pos.symbol,
              action: `Auto-sold ${newlyClosed.pos.symbol} — target hit (${newlyClosed.pos.targetMultiplier}x)`,
              amount: `${newlyClosed.pos.currentSol.toFixed(4)} SOL`,
              status: 'success' as ActivityStatus,
              tx: makeTx(),
              pnlSol: newlyClosed.pnl,
            },
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
    // auto-snipe if enabled and passes filters
    if (settings.autoEnabled && pool.passedFilters && Math.random() > 0.35) {
      setTimeout(() => get().snipePool(pool.id), 600);
    } else if (settings.autoEnabled && pool.passedFilters) {
      get().addLog({
        token: pool.symbol,
        action: `Detected ${pool.symbol} — skipped (filter margin)`,
        amount: '-',
        status: 'pending',
      });
    }
  },

  clearActivity: () => set({ activity: [] }),

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
