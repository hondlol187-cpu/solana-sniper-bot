'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Crosshair, ExternalLink } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useSniperStore } from '@/lib/sniper-store';

export function OpenPositions() {
  const positions = useSniperStore((s) => s.positions);
  const walletConnected = useSniperStore((s) => s.walletConnected);
  const sellPosition = useSniperStore((s) => s.sellPosition);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Crosshair className="h-5 w-5 text-muted-foreground" />
            Open Positions
          </span>
          <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
            {positions.length}
          </Badge>
        </CardTitle>
        <CardDescription>Live positions with unrealized PnL — auto-sells at target</CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        {positions.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <Crosshair className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              No open positions. Snipe a token to open one.
            </p>
          </div>
        ) : (
          <div className="max-h-80 space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent">
            <AnimatePresence initial={false}>
              {positions.map((p) => {
                const currentMult = p.currentSol / p.entrySol;
                const pnlSol = p.currentSol - p.entrySol;
                const pnlPct = (pnlSol / p.entrySol) * 100;
                const positive = pnlSol >= 0;
                const progress = Math.min(
                  100,
                  Math.max(0, ((currentMult - 1) / (p.targetMultiplier - 1)) * 100)
                );
                return (
                  <motion.div
                    key={p.id}
                    layout
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.3 }}
                    className="rounded-lg border border-border/70 bg-muted/30 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-semibold">${p.symbol}</span>
                          <span className="truncate font-mono text-[11px] text-muted-foreground">
                            {p.mint}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          Entry {p.entrySol.toFixed(4)} · Now {p.currentSol.toFixed(4)} SOL
                          {p.tx && (
                            <a
                              href={p.tx}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-2 inline-flex items-center gap-0.5 text-emerald-400 hover:text-emerald-300 hover:underline"
                            >
                              tx <ExternalLink className="h-2.5 w-2.5" />
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge
                          variant="outline"
                          className={
                            positive
                              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                              : 'border-red-500/40 bg-red-500/10 text-red-400'
                          }
                        >
                          {positive ? '+' : ''}
                          {pnlPct.toFixed(1)}%
                        </Badge>
                        <span
                          className={`text-[11px] font-medium tabular-nums ${
                            positive ? 'text-emerald-400' : 'text-red-400'
                          }`}
                        >
                          {positive ? '+' : ''}
                          {pnlSol.toFixed(4)} SOL
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span>1x</span>
                        <span>
                          {currentMult.toFixed(2)}x · target {p.targetMultiplier}x
                        </span>
                      </div>
                      <Progress value={progress} className="h-1.5" />
                    </div>
                    <div className="mt-2 flex justify-end">
                      <Button
                        size="sm"
                        variant={positive ? 'default' : 'outline'}
                        disabled={!walletConnected}
                        onClick={() => sellPosition(p.id)}
                        className={`h-7 gap-1 px-2 text-xs ${
                          positive
                            ? 'border border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500'
                            : ''
                        }`}
                      >
                        Sell
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
