'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Activity,
  AlertTriangle,
  ExternalLink,
  Play,
  Radio,
  Settings,
  ShieldCheck,
  Square,
  Trash2,
  Wallet,
  Zap,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useSniperStore } from '@/lib/sniper-store';
import { KpiCards } from '@/components/sniper/kpi-cards';
import { PnlChart } from '@/components/sniper/pnl-chart';
import { DetectedPools } from '@/components/sniper/detected-pools';
import { OpenPositions } from '@/components/sniper/open-positions';
import { Presets } from '@/components/sniper/presets';
import { ThemeToggle } from '@/components/sniper/theme-toggle';
import { SolPriceTicker } from '@/components/sniper/sol-price-ticker';

const STATUS_VARIANT: Record<
  'success' | 'failed' | 'pending',
  { className: string; dot: string }
> = {
  success: {
    className:
      'border-emerald-500/40 bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/15',
    dot: 'bg-emerald-400',
  },
  failed: {
    className:
      'border-red-500/40 bg-red-500/15 text-red-400 hover:bg-red-500/15',
    dot: 'bg-red-400',
  },
  pending: {
    className:
      'border-amber-500/40 bg-amber-500/15 text-amber-400 hover:bg-amber-500/15',
    dot: 'bg-amber-400',
  },
};

function RealMonitorStatus() {
  const realMonitor = useSniperStore((s) => s.realMonitor);
  const useRealMonitor = useSniperStore((s) => s.settings.useRealMonitor);
  if (!useRealMonitor) return null;
  const lastEvent = realMonitor.lastEventAt
    ? new Date(realMonitor.lastEventAt).toLocaleTimeString()
    : '—';
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${
            realMonitor.active ? 'animate-pulse bg-cyan-400' : 'bg-muted-foreground'
          }`}
        />
        {realMonitor.active ? 'Connected' : 'Disconnected'}
      </span>
      <span>Detected: {realMonitor.detectedCount}</span>
      <span>Last event: {lastEvent}</span>
      {realMonitor.error && (
        <span className="text-red-400">⚠ {realMonitor.error.slice(0, 40)}</span>
      )}
    </div>
  );
}

export default function SniperDashboard() {
  const settings = useSniperStore((s) => s.settings);
  const isRunning = useSniperStore((s) => s.isRunning);
  const activity = useSniperStore((s) => s.activity);
  const walletConnected = useSniperStore((s) => s.walletConnected);
  const walletAddress = useSniperStore((s) => s.walletAddress);
  const phantomAvailable = useSniperStore((s) => s.phantomAvailable);
  const theme = useSniperStore((s) => s.theme);

  const setRunning = useSniperStore((s) => s.setRunning);
  const connectWallet = useSniperStore((s) => s.connectWallet);
  const initWallet = useSniperStore((s) => s.initWallet);
  const updateSetting = useSniperStore((s) => s.updateSetting);
  const snipeNow = useSniperStore((s) => s.snipeNow);
  const tick = useSniperStore((s) => s.tick);
  const spawnPool = useSniperStore((s) => s.spawnPool);
  const clearActivity = useSniperStore((s) => s.clearActivity);

  // Detect Phantom injected provider on mount
  useEffect(() => {
    initWallet();
  }, [initWallet]);

  // Price-tick + PnL update interval (always on, cheap)
  useEffect(() => {
    const id = setInterval(() => tick(), 2000);
    return () => clearInterval(id);
  }, [tick]);

  // New-pool spawner (simulation, only meaningful while running)
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => spawnPool(), 3500);
    return () => clearInterval(id);
  }, [isRunning, spawnPool]);

  // Real RPC monitor lifecycle: start when running + enabled, stop otherwise
  const startRealMonitor = useSniperStore((s) => s.startRealMonitor);
  const stopRealMonitor = useSniperStore((s) => s.stopRealMonitor);
  const useRealMonitor = useSniperStore((s) => s.settings.useRealMonitor);
  useEffect(() => {
    if (isRunning && useRealMonitor) {
      startRealMonitor();
      return () => stopRealMonitor();
    }
    // If monitor was running but isRunning/useRealMonitor flipped off, stop it
    stopRealMonitor();
  }, [isRunning, useRealMonitor, startRealMonitor, stopRealMonitor]);

  const handleSnipeNow = () => {
    if (!walletConnected) return;
    snipeNow();
  };

  const handleStartStop = () => {
    setRunning(!isRunning);
  };

  return (
    <div
      className={`${theme} min-h-screen flex flex-col bg-background text-foreground`}
    >
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10">
              <Zap className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                Solana Sniper
              </h1>
              <p className="text-sm text-muted-foreground">
                Auto Sniper with Scam Protection
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Button
              variant="outline"
              onClick={connectWallet}
              className={
                walletConnected
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300'
                  : ''
              }
            >
              <Wallet className="mr-2 h-4 w-4" />
              {walletConnected
                ? walletAddress || 'Connected'
                : phantomAvailable
                  ? 'Connect Phantom'
                  : 'Connect Wallet'}
            </Button>

            <SolPriceTicker />

            <Badge
              variant="outline"
              className={
                settings.liveTrading
                  ? 'border-amber-500/50 bg-amber-500/15 px-3 py-1.5 text-amber-400'
                  : 'border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-cyan-400'
              }
              title={settings.liveTrading ? 'Live trading mode — real funds at risk' : 'Dry-run mode — swaps simulated only'}
            >
              {settings.liveTrading ? '⚠ LIVE' : 'DRY RUN'}
            </Badge>

            <Badge
              variant="outline"
              className={
                isRunning
                  ? 'border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-emerald-400'
                  : 'border-border bg-muted px-3 py-1.5 text-muted-foreground'
              }
            >
              <span
                className={`mr-2 inline-block h-2 w-2 rounded-full ${
                  isRunning ? 'animate-pulse bg-emerald-400' : 'bg-muted-foreground'
                }`}
              />
              {isRunning ? 'AUTO RUNNING' : 'STOPPED'}
            </Badge>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="container mx-auto flex-1 px-4 py-6 sm:px-6">
        <div className="space-y-6">
          {/* KPI row */}
          <KpiCards />

          {/* Charts + settings row */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Settings + presets + control */}
            <div className="space-y-6 lg:col-span-1">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5 text-muted-foreground" />
                    Sniper Settings
                  </CardTitle>
                  <CardDescription>Configure your auto sniper parameters</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  <Presets />
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="buyAmountSol">Buy Amount (SOL)</Label>
                      <Input
                        id="buyAmountSol"
                        type="number"
                        value={settings.buyAmountSol}
                        onChange={(e) =>
                          updateSetting('buyAmountSol', parseFloat(e.target.value) || 0)
                        }
                        step="0.01"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="slippage">Slippage (%)</Label>
                      <Input
                        id="slippage"
                        type="number"
                        value={settings.slippageBps / 100}
                        onChange={(e) =>
                          updateSetting('slippageBps', (parseFloat(e.target.value) || 0) * 100)
                        }
                        step="0.1"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="targetMultiplier">Target (x)</Label>
                      <Input
                        id="targetMultiplier"
                        type="number"
                        value={settings.targetMultiplier}
                        onChange={(e) =>
                          updateSetting('targetMultiplier', parseFloat(e.target.value) || 0)
                        }
                        step="0.1"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="minLiquiditySol">Min LIQ (SOL)</Label>
                      <Input
                        id="minLiquiditySol"
                        type="number"
                        value={settings.minLiquiditySol}
                        onChange={(e) =>
                          updateSetting('minLiquiditySol', parseFloat(e.target.value) || 0)
                        }
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="autoEnabled" className="flex items-center gap-1.5 text-sm">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                        Auto Mode + Scam Filter
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        Auto-snipe tokens that pass mint/freeze/liquidity checks
                      </p>
                    </div>
                    <Switch
                      id="autoEnabled"
                      checked={settings.autoEnabled}
                      onCheckedChange={(checked) => updateSetting('autoEnabled', checked)}
                    />
                  </div>

                  {/* Live RPC monitor toggle + URL */}
                  <div className="space-y-3 rounded-lg border border-cyan-500/30 bg-cyan-500/[0.06] p-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="useRealMonitor" className="flex items-center gap-1.5 text-sm">
                          <Radio className="h-3.5 w-3.5 text-cyan-400" />
                          Live RPC Monitor
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Subscribe to real Raydium onLogs + decode initialize2
                        </p>
                      </div>
                      <Switch
                        id="useRealMonitor"
                        checked={settings.useRealMonitor}
                        onCheckedChange={(checked) => updateSetting('useRealMonitor', checked)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rpcUrl" className="text-xs text-muted-foreground">
                        RPC URL
                      </Label>
                      <Input
                        id="rpcUrl"
                        type="text"
                        value={settings.rpcUrl}
                        onChange={(e) => updateSetting('rpcUrl', e.target.value)}
                        placeholder="https://api.mainnet-beta.solana.com"
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                    <RealMonitorStatus />
                  </div>

                  {/* Trading mode + price impact limit (mirrors CLI config) */}
                  <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label htmlFor="liveTrading" className="flex items-center gap-1.5 text-sm">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                          Live Trading
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Off = dry-run (simulate). On = real funds at risk.
                        </p>
                      </div>
                      <Switch
                        id="liveTrading"
                        checked={settings.liveTrading}
                        onCheckedChange={(checked) => updateSetting('liveTrading', checked)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="maxPriceImpactPct" className="text-xs text-muted-foreground">
                        Max Price Impact (%)
                      </Label>
                      <Input
                        id="maxPriceImpactPct"
                        type="number"
                        value={settings.maxPriceImpactPct}
                        onChange={(e) =>
                          updateSetting('maxPriceImpactPct', parseFloat(e.target.value) || 0)
                        }
                        step="0.1"
                        className="h-8"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Control panel */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5 text-muted-foreground" />
                    Auto Sniper Control
                  </CardTitle>
                  <CardDescription>Start monitoring and sniping</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Button
                    onClick={handleStartStop}
                    size="lg"
                    variant={isRunning ? 'destructive' : 'default'}
                    className={`w-full ${
                      !isRunning
                        ? 'border border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500'
                        : ''
                    }`}
                  >
                    {isRunning ? (
                      <>
                        <Square className="mr-2 h-4 w-4" /> Stop Auto Sniper
                      </>
                    ) : (
                      <>
                        <Play className="mr-2 h-4 w-4" /> Start Auto Sniper
                      </>
                    )}
                  </Button>
                  <Button
                    onClick={handleSnipeNow}
                    variant="outline"
                    size="lg"
                    disabled={!walletConnected}
                    className="w-full"
                  >
                    <Zap className="mr-2 h-4 w-4" /> Snipe Now (Manual)
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* PnL chart */}
            <div className="lg:col-span-2">
              <PnlChart />
            </div>
          </div>

          {/* Pools + positions row */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <DetectedPools />
            <OpenPositions />
          </div>

          {/* Activity Log */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-muted-foreground" />
                  Activity Log
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                    {activity.length} entries
                  </Badge>
                  {activity.length > 0 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={clearActivity}
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <Trash2 className="h-3 w-3" /> Clear
                    </Button>
                  )}
                </div>
              </CardTitle>
              <CardDescription>Real-time sniper activity and transactions</CardDescription>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <Activity className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    No activity yet. Start the auto sniper or click &quot;Snipe Now&quot;.
                  </p>
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto rounded-md border border-border [scrollbar-width:thin] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card">
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Token</TableHead>
                        <TableHead>Action</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>PnL</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Tx</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activity.map((log) => {
                        const v = STATUS_VARIANT[log.status];
                        return (
                          <motion.tr
                            key={log.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.3 }}
                            className="border-b border-border/60 transition-colors hover:bg-muted/40"
                          >
                              <TableCell className="font-mono text-xs text-muted-foreground">
                                {log.time}
                              </TableCell>
                              <TableCell className="font-medium">{log.token}</TableCell>
                              <TableCell className="text-sm">{log.action}</TableCell>
                              <TableCell className="font-mono text-sm">{log.amount}</TableCell>
                              <TableCell className="font-mono text-xs">
                                {log.pnlSol != null ? (
                                  <span
                                    className={
                                      log.pnlSol >= 0 ? 'text-emerald-400' : 'text-red-400'
                                    }
                                  >
                                    {log.pnlSol >= 0 ? '+' : ''}
                                    {log.pnlSol.toFixed(4)}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className={v.className}>
                                  <span
                                    className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${v.dot}`}
                                  />
                                  {log.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                {log.tx ? (
                                  <a
                                    href={log.tx}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 hover:underline"
                                  >
                                    View
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <span className="text-muted-foreground">-</span>
                                )}
                              </TableCell>
                            </motion.tr>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Footer (sticky to bottom) */}
      <footer className="mt-auto border-t border-border/60 bg-background/80">
        <div className="container mx-auto px-4 py-4 sm:px-6">
          <p className="text-center text-xs text-muted-foreground">
            ⚠️ Experimental software — simulated flows. Use a burner wallet, test on
            devnet first. Not financial advice. Trade at your own risk.
          </p>
        </div>
      </footer>
    </div>
  );
}
