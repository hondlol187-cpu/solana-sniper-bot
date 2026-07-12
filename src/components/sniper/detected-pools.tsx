'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Radio, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSniperStore } from '@/lib/sniper-store';

function formatAge(sec: number) {
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

export function DetectedPools() {
  const pools = useSniperStore((s) => s.pools);
  const isRunning = useSniperStore((s) => s.isRunning);
  const walletConnected = useSniperStore((s) => s.walletConnected);
  const snipePool = useSniperStore((s) => s.snipePool);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-muted-foreground" />
            Detected Pools
          </span>
          <Badge
            variant="outline"
            className={
              isRunning
                ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400'
                : 'border-border bg-muted text-muted-foreground'
            }
          >
            <span
              className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
                isRunning ? 'animate-pulse bg-cyan-400' : 'bg-muted-foreground'
              }`}
            />
            {isRunning ? 'LIVE' : 'IDLE'}
          </Badge>
        </CardTitle>
        <CardDescription>New liquidity pools streaming from the monitor</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {pools.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Radio className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              {isRunning
                ? 'Scanning mempool for new launches…'
                : 'Start the auto sniper to begin detecting new pools.'}
            </p>
          </div>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
            <AnimatePresence initial={false}>
              {pools.map((pool) => {
                const up = pool.change5m >= 0;
                return (
                  <motion.div
                    key={pool.id}
                    layout
                    initial={{ opacity: 0, x: -16 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 16 }}
                    transition={{ duration: 0.4 }}
                    className="rounded-lg border border-border/70 bg-muted/30 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold">${pool.symbol}</span>
                          <span className="truncate font-mono text-[11px] text-muted-foreground">
                            {pool.mint}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>Age {formatAge(pool.ageSec)}</span>
                          <span>LIQ {pool.liquiditySol.toFixed(1)} SOL</span>
                          <span>MC ${Math.round(pool.marketCapUsd).toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge
                          variant="outline"
                          className={
                            up
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                              : 'border-red-500/40 bg-red-500/10 text-red-400'
                          }
                        >
                          {up ? '+' : ''}
                          {pool.change5m.toFixed(1)}%
                        </Badge>
                        {!pool.passedFilters && (
                          <span className="text-[10px] uppercase text-amber-500/80">filtered</span>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!walletConnected}
                        onClick={() => snipePool(pool.id)}
                        className="h-7 gap-1 px-2 text-xs"
                      >
                        <Zap className="h-3 w-3" /> Snipe
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
