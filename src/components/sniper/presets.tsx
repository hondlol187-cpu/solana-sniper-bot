'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { PRESETS, useSniperStore, type PresetKey } from '@/lib/sniper-store';
import { Shield, Scale, Flame } from 'lucide-react';

const ICONS: Record<PresetKey, React.ReactNode> = {
  safe: <Shield className="h-4 w-4" />,
  balanced: <Scale className="h-4 w-4" />,
  degen: <Flame className="h-4 w-4" />,
};

export function Presets() {
  const settings = useSniperStore((s) => s.settings);
  const applyPreset = useSniperStore((s) => s.applyPreset);

  const isActive = (key: PresetKey) => {
    const p = PRESETS.find((x) => x.key === key);
    if (!p) return false;
    return (
      p.settings.buyAmountSol === settings.buyAmountSol &&
      p.settings.slippageBps === settings.slippageBps &&
      p.settings.targetMultiplier === settings.targetMultiplier &&
      p.settings.minLiquiditySol === settings.minLiquiditySol
    );
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        Quick Presets
      </Label>
      <div className="grid grid-cols-3 gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.key}
            type="button"
            variant={isActive(p.key) ? 'default' : 'outline'}
            size="sm"
            onClick={() => applyPreset(p.key)}
            className={`h-auto flex-col items-start gap-0.5 px-3 py-2 text-left ${
              isActive(p.key)
                ? 'border-emerald-500/40 bg-emerald-600 text-white hover:bg-emerald-500'
                : ''
            }`}
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold">
              {ICONS[p.key]}
              {p.label}
            </span>
            <span className="text-[10px] font-normal opacity-80">{p.description}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}
