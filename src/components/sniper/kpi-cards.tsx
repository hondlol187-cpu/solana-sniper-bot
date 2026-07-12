'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity, Crosshair, Percent, Wallet } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { motion } from 'framer-motion';
import { selectKpis, useSniperStore } from '@/lib/sniper-store';
import { useShallow } from 'zustand/react/shallow';
import { useMemo } from 'react';

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const d = useMemo(() => data.map((v, i) => ({ i, v })), [data]);
  return (
    <ResponsiveContainer width="100%" height={36}>
      <LineChart data={d} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
        <YAxis domain={['dataMin', 'dataMax']} hide />
        <Line
          type="monotone"
          dataKey="v"
          stroke={color}
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaPositive?: boolean;
  icon: React.ReactNode;
  spark?: number[];
  sparkColor?: string;
  accent: string;
  index: number;
}

function KpiCard({
  label,
  value,
  delta,
  deltaPositive,
  icon,
  spark,
  sparkColor,
  accent,
  index,
}: KpiCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06 }}
    >
      <Card className="relative overflow-hidden">
        <div className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 ${accent}`} />
        <CardContent className="p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums">
                {value}
              </p>
            </div>
            <div className="rounded-lg border border-border/60 bg-muted/40 p-2 text-muted-foreground">
              {icon}
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between">
            {delta ? (
              <Badge
                variant="outline"
                className={
                  deltaPositive
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : 'border-red-500/40 bg-red-500/10 text-red-400'
                }
              >
                {delta}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
            {spark && spark.length > 1 && (
              <div className="h-9 w-24 opacity-80">
                <Sparkline data={spark} color={sparkColor || '#10b981'} />
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export function KpiCards() {
  const kpis = useSniperStore(useShallow(selectKpis));
  const pnlHistory = useSniperStore((s) => s.pnlHistory);
  const sparkData = useSniperStore((s) => s.sparkData);

  const pnlSpark = useMemo(
    () => pnlHistory.slice(-12).map((p) => p.pnl),
    [pnlHistory]
  );
  const winSpark = useMemo(
    () => sparkData.map((v) => v * (kpis.successRate / 100) * 2),
    [sparkData, kpis.successRate]
  );

  const pnlPositive = kpis.totalPnl >= 0;

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KpiCard
        index={0}
        label="Total PnL"
        value={`${pnlPositive ? '+' : ''}${kpis.totalPnl.toFixed(4)} SOL`}
        delta={`${pnlPositive ? '+' : ''}${kpis.realized.toFixed(4)} realized`}
        deltaPositive={pnlPositive}
        icon={<Wallet className="h-4 w-4" />}
        spark={pnlSpark}
        sparkColor={pnlPositive ? '#10b981' : '#f43f5e'}
        accent="bg-emerald-500"
      />
      <KpiCard
        index={1}
        label="Win Rate"
        value={`${kpis.successRate}%`}
        delta={`${kpis.winsToday} wins`}
        deltaPositive={kpis.successRate >= 50}
        icon={<Percent className="h-4 w-4" />}
        spark={winSpark}
        sparkColor="#a855f7"
        accent="bg-purple-500"
      />
      <KpiCard
        index={2}
        label="Active Positions"
        value={String(kpis.activePositions)}
        delta={`${kpis.snipesToday} sniped today`}
        deltaPositive={kpis.activePositions > 0}
        icon={<Crosshair className="h-4 w-4" />}
        spark={sparkData}
        sparkColor="#f59e0b"
        accent="bg-amber-500"
      />
      <KpiCard
        index={3}
        label="Pools Watched"
        value={String(kpis.poolsWatched)}
        delta="live feed"
        deltaPositive
        icon={<Activity className="h-4 w-4" />}
        spark={sparkData.slice().reverse()}
        sparkColor="#06b6d4"
        accent="bg-cyan-500"
      />
    </div>
  );
}
