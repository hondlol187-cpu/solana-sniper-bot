'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp } from 'lucide-react';
import { useSniperStore } from '@/lib/sniper-store';

function formatTime(t: number) {
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function PnlChart() {
  const pnlHistory = useSniperStore((s) => s.pnlHistory);
  const totalPnl = useSniperStore(
    (s) => s.realizedPnlSol + s.positions.reduce((a, p) => a + (p.currentSol - p.entrySol), 0)
  );
  const positive = totalPnl >= 0;
  const color = positive ? '#10b981' : '#f43f5e';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-muted-foreground" />
            Equity Curve
          </span>
          <span
            className={`text-sm font-semibold tabular-nums ${
              positive ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {positive ? '+' : ''}
            {totalPnl.toFixed(4)} SOL
          </span>
        </CardTitle>
        <CardDescription>Realized + unrealized PnL over time</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-48 w-full text-muted-foreground">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={pnlHistory} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis
                dataKey="t"
                tickFormatter={formatTime}
                tick={{ fontSize: 10, fill: 'currentColor' }}
                stroke="rgba(255,255,255,0.1)"
                minTickGap={48}
              />
              <YAxis
                tick={{ fontSize: 10, fill: 'currentColor' }}
                stroke="rgba(255,255,255,0.1)"
                width={48}
                tickFormatter={(v) => `${Number(v).toFixed(3)}`}
              />
              <Tooltip
                contentStyle={{
                  background: 'rgba(20,20,22,0.95)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelFormatter={(t) => formatTime(Number(t))}
                formatter={(v: number) => [`${Number(v).toFixed(4)} SOL`, 'PnL']}
              />
              <Area
                type="monotone"
                dataKey="pnl"
                stroke={color}
                strokeWidth={2}
                fill="url(#pnlFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
