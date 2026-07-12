'use client';

import { Button } from '@/components/ui/button';
import { Moon, Sun } from 'lucide-react';
import { useSniperStore } from '@/lib/sniper-store';

export function ThemeToggle() {
  const theme = useSniperStore((s) => s.theme);
  const toggleTheme = useSniperStore((s) => s.toggleTheme);
  const isDark = theme === 'dark';
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-label="Toggle theme"
      title={isDark ? 'Switch to light' : 'Switch to dark'}
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
