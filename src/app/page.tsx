'use client';

import { useState } from 'react';
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
  ExternalLink,
  Play,
  Settings,
  Square,
  TrendingUp,
  Wallet,
  Zap,
} from 'lucide-react';

interface SniperSettings {
  buyAmountSol: number;
  slippageBps: number;
  targetMultiplier: number;
  minLiquiditySol: number;
  autoEnabled: boolean;
}

interface ActivityLog {
  id: number;
  time: string;
  token: string;
  action: string;
  amount: string;
  status: 'success' | 'failed' | 'pending';
  tx?: string;
}

const STATUS_VARIANT: Record<
  ActivityLog['status'],
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

export default function SniperDashboard() {
  const [settings, setSettings] = useState<SniperSettings>({
    buyAmountSol: 0.05,
    slippageBps: 300,
    targetMultiplier: 2.0,
    minLiquiditySol: 10,
    autoEnabled: false,
  });

  const [isRunning, setIsRunning] = useState(false);
  const [activity, setActivity] = useState<ActivityLog[]>([]);
  const [walletConnected, setWalletConnected] = useState(false);

  const addLog = (log: Omit<ActivityLog, 'id' | 'time'>) => {
    const newLog: ActivityLog = {
      ...log,
      id: Date.now(),
      time: new Date().toLocaleTimeString(),
    };
    setActivity((prev) => [newLog, ...prev].slice(0, 20));
  };

  const handleStartStop = () => {
    if (isRunning) {
      setIsRunning(false);
      addLog({
        token: 'System',
        action: 'Auto Sniper Stopped',
        amount: '-',
        status: 'success',
      });
    } else {
      setIsRunning(true);
      addLog({
        token: 'System',
        action: 'Auto Sniper Started',
        amount: '-',
        status: 'success',
      });

      // Demo simulation
      setTimeout(() => {
        if (settings.autoEnabled) {
          addLog({
            token: 'New Token XYZ',
            action: 'Detected new pool',
            amount: '-',
            status: 'pending',
          });
        }
      }, 3000);
    }
  };

  const handleSnipeNow = async () => {
    addLog({
      token: 'Manual Snipe',
      action: 'Executing Jupiter swap...',
      amount: `${settings.buyAmountSol} SOL`,
      status: 'pending',
    });

    setTimeout(() => {
      const success = Math.random() > 0.3;
      addLog({
        token: 'Manual Snipe',
        action: success ? 'Swap successful' : 'Swap failed',
        amount: `${settings.buyAmountSol} SOL`,
        status: success ? 'success' : 'failed',
        tx: success ? 'https://solscan.io/tx/...' : undefined,
      });
    }, 1500);
  };

  const handleConnectWallet = () => {
    setWalletConnected((prev) => {
      const next = !prev;
      addLog({
        token: 'System',
        action: next ? 'Wallet connected' : 'Wallet disconnected',
        amount: '-',
        status: 'success',
      });
      return next;
    });
  };

  const updateSetting = (
    key: keyof SniperSettings,
    value: number | boolean
  ) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const successRate =
    activity.length > 0
      ? Math.round(
          (activity.filter((a) => a.status === 'success').length /
            activity.length) *
            100
        )
      : 0;

  return (
    <div className="dark min-h-screen flex flex-col bg-background text-foreground">
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
                Full Auto Sniper Dashboard
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={handleConnectWallet}
              className={
                walletConnected
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15 hover:text-emerald-300'
                  : ''
              }
            >
              <Wallet className="mr-2 h-4 w-4" />
              {walletConnected ? 'Connected' : 'Connect Wallet'}
            </Button>

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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Settings Panel */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-muted-foreground" />
                Sniper Settings
              </CardTitle>
              <CardDescription>
                Configure your auto sniper parameters
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="buyAmountSol">Buy Amount (SOL)</Label>
                <Input
                  id="buyAmountSol"
                  type="number"
                  value={settings.buyAmountSol}
                  onChange={(e) =>
                    updateSetting('buyAmountSol', parseFloat(e.target.value))
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
                    updateSetting(
                      'slippageBps',
                      parseFloat(e.target.value) * 100
                    )
                  }
                  step="0.1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="targetMultiplier">Target Multiplier (x)</Label>
                <Input
                  id="targetMultiplier"
                  type="number"
                  value={settings.targetMultiplier}
                  onChange={(e) =>
                    updateSetting(
                      'targetMultiplier',
                      parseFloat(e.target.value)
                    )
                  }
                  step="0.1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="minLiquiditySol">Min Liquidity (SOL)</Label>
                <Input
                  id="minLiquiditySol"
                  type="number"
                  value={settings.minLiquiditySol}
                  onChange={(e) =>
                    updateSetting(
                      'minLiquiditySol',
                      parseFloat(e.target.value)
                    )
                  }
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 p-4 sm:col-span-2">
                <div className="space-y-0.5">
                  <Label htmlFor="autoEnabled" className="text-base">
                    Auto Mode
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically snipe new tokens
                  </p>
                </div>
                <Switch
                  id="autoEnabled"
                  checked={settings.autoEnabled}
                  onCheckedChange={(checked) =>
                    updateSetting('autoEnabled', checked)
                  }
                />
              </div>
            </CardContent>
          </Card>

          {/* Control Panel */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-muted-foreground" />
                Auto Sniper Control
              </CardTitle>
              <CardDescription>
                Start automatic monitoring and sniping
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="flex flex-col gap-3">
                <Button
                  onClick={handleStartStop}
                  size="lg"
                  variant={isRunning ? 'destructive' : 'default'}
                  className={
                    !isRunning
                      ? 'border border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500'
                      : ''
                  }
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

                <Button onClick={handleSnipeNow} variant="outline" size="lg">
                  <Zap className="mr-2 h-4 w-4" /> Snipe Now (Manual)
                </Button>
              </div>

              <div className="grid grid-cols-3 gap-3 border-t border-border pt-5">
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Status
                  </p>
                  <p
                    className={`text-sm font-semibold ${
                      isRunning ? 'text-emerald-400' : ''
                    }`}
                  >
                    {isRunning ? 'Monitoring' : 'Idle'}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Snipes Today
                  </p>
                  <p className="text-sm font-semibold">{activity.length}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Success Rate
                  </p>
                  <p className="flex items-center gap-1 text-sm font-semibold">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                    {successRate}%
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Activity Log */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-muted-foreground" />
                Activity Log
              </CardTitle>
              <CardDescription>
                Real-time sniper activity and transactions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                  <Activity className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    No activity yet. Start the auto sniper or click &quot;Snipe
                    Now&quot;.
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
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Tx</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activity.map((log) => {
                        const v = STATUS_VARIANT[log.status];
                        return (
                          <TableRow key={log.id}>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                              {log.time}
                            </TableCell>
                            <TableCell className="font-medium">
                              {log.token}
                            </TableCell>
                            <TableCell className="text-sm">
                              {log.action}
                            </TableCell>
                            <TableCell className="font-mono text-sm">
                              {log.amount}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={v.className}
                              >
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
                          </TableRow>
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
            ⚠️ Experimental software — use a burner wallet, test on devnet
            first. Not financial advice. Trade at your own risk.
          </p>
        </div>
      </footer>
    </div>
  );
}
