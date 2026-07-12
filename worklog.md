# Solana Sniper Bot — Project Worklog

This worklog tracks development of the project at `/home/z/my-project`
(Next.js 16 + Tailwind 4 + shadcn/ui + Prisma), published to GitHub at
https://github.com/hondlol187-cpu/solana-sniper-bot

---
Task ID: 1
Agent: main (Z.ai Code)
Task: Reconstruct the Solana Sniper dashboard UI in src/app/page.tsx
       (user pasted JSX but the IM gateway stripped all tags — reconstructed
        a faithful, working version from imports/state/handlers/text fragments)

Work Log:
- Inspected layout.tsx (Geist fonts, bg-background, Toaster, no ThemeProvider)
  and globals.css (light + dark CSS vars defined; .dark class toggles dark theme).
- Reconstructed SniperDashboard component in src/app/page.tsx with:
  - Dark trading aesthetic via `dark` class wrapper (emerald/red/amber accents;
    avoided indigo/blue per styling rules).
  - Sticky header: title "Solana Sniper", Connect Wallet toggle, live
    AUTO RUNNING / STOPPED pulse badge.
  - Settings panel (Card, lg:col-span-2): Buy Amount, Slippage (%),
    Target Multiplier, Min Liquidity, Auto Mode switch.
  - Control panel (Card, lg:col-span-1): Start/Stop Auto Sniper + Snipe Now
    (manual) + stats row (Status / Snipes Today / Success Rate).
  - Activity log (Card, full width): shadcn Table with Time/Token/Action/
    Amount/Status/Tx columns; status-colored badges (success=emerald,
    failed=red, pending=amber); scrollable max-h-96 with custom scrollbar;
    Solscan tx links; empty state.
  - Sticky footer with risk disclaimer using `min-h-screen flex flex-col`
    + `mt-auto` pattern (per UI rules).
  - Responsive: grid-cols-1 on mobile, lg:grid-cols-3 on desktop.
- Fixed mangled TypeScript from chat gateway: `Omit<ActivityLog,'id'|'time'>`
  and `useState<ActivityLog[]>([])` generics restored.
- Dev server: started via `exec ./node_modules/.bin/next dev -p 3000` with
  setsid/nohup (the `bun run dev` npm script uses a `| tee` pipeline that
  breaks when the bash session ends). NOTE: dev server does NOT persist
  between Bash tool calls in this sandbox — must start + verify in one command.
- Verified via agent-browser:
  - GET / 200, compile 3.4s, render 162ms, zero console errors/warnings.
  - Snapshot confirms all elements render (heading, 4 inputs, switch, 2 buttons).
  - Interactions: Connect Wallet -> "Connected"; Snipe Now -> pending then
    "Swap successful" + "View" tx link; Start Auto Sniper -> "Stop Auto Sniper"
    + log entry; Auto Mode toggle -> checked=true.
  - Activity log populates with correct columns + status badges + tx links.
  - Footer exists at natural bottom (footerBottom == docScrollHeight).
  - Mobile viewport (390x844) stacks to single column correctly.
- Lint: `bun run lint` clean (eslint config ignores sniper/).
- Git: reconciled divergence (remote had sniper commit as bb43b06, local
  recreated as fd50c6a same content). Reset to origin/main, cherry-picked
  dashboard commit cleanly. Pushed as 89be730 (fast-forward bb43b06..89be730).
- Token ghp_r4wt... used via one-time credential URL; NOT stored in git config.

Stage Summary:
- Dashboard UI complete and pushed to GitHub main (commit 89be730).
- Repo now has: sniper/ CLI bot (Jupiter swap + monitor stub) + web dashboard
  in src/app/page.tsx + original Next.js starter preserved.
- All interactions verified working in browser; zero console errors.
- Outstanding: user must REVOKE the GitHub token ghp_r4wt... (compromised,
  typed in chat multiple times).

Current project status:
- Stable. The / route renders a working Solana Sniper dashboard with simulated
  trading flows (manual snipe, auto-start, wallet connect). Backend sniper/
  CLI is a foundation (Jupiter swap works; monitor.ts is a stub).

Unresolved issues / risks / next-phase priorities:
- The dashboard is UI-only with simulated flows (setTimeout + Math.random).
  It does NOT call the sniper/ CLI or any real Solana logic. Next phase could
  wire the dashboard to real backend via API routes (e.g. POST /api/snipe,
  /api/settings, /api/activity) that invoke sniper/jupiter.ts server-side.
- Dev server does not persist between Bash tool invocations in this sandbox;
  the 15-min webDevReview cron must start dev + verify in a single command,
  OR rely on the sandbox supervisor. (The canonical .zscripts/dev.sh is missing.)
- GitHub token ghp_r4wt... is compromised and still active as of last check —
  user must revoke at https://github.com/settings/tokens.
- monitor.ts is a skeleton; real new-pool sniping needs instruction decoding
  + filters + Jito bundles (see README).

---
Task ID: 2
Agent: webDevReview cron (15-min)
Task: QA current dashboard, then advance with new features + styling improvements

Work Log:
- Read worklog (Task 1) to establish baseline: v1 dashboard stable, simulated flows,
  zero console errors. Identified next-step candidates from worklog.
- QA baseline via agent-browser (start dev + verify in ONE bash command — dev server
  does not persist between Bash calls in this sandbox): GET / 200, zero console errors,
  all v1 elements render. Confirmed stable baseline.
- Built Dashboard v2 with a central zustand store + simulation engine:

  New state layer — src/lib/sniper-store.ts (zustand v5):
  - Full app state: settings, isRunning, walletConnected, theme, activity (50 cap),
    positions, pools (12 cap), pnlHistory (60 cap), realizedPnlSol, snipesToday,
    winsToday, sparkData.
  - Simulation engine: tick() (called every 2s via useEffect) random-walks each
    position's currentSol with slight positive bias, auto-closes at target multiplier
    (realizes PnL, logs "Auto-sold — target hit"); spawnPool() (every 3.5s when
    running) generates a new DetectedPool with random symbol/mint/liquidity/mcap/
    age/5m-change, auto-snipes if Auto Mode + passes filters.
  - Actions: snipeNow, snipePool, sellPosition, applyPreset (Safe/Balanced/Degen),
    connectWallet, toggleTheme, clearActivity, resetAll.
  - selectKpis derived selector (total/realized/unrealized PnL, win rate, counts).
  - PRESETS: Safe (0.02 SOL, 2% slip, 2x), Balanced (0.05, 5%, 3x), Degen (0.15, 15%, 5x).

  New components — src/components/sniper/:
  - kpi-cards.tsx: 4 stat cards (Total PnL, Win Rate, Active Positions, Pools Watched)
    with recharts sparklines + framer-motion staggered entrance. Uses useShallow.
  - pnl-chart.tsx: recharts AreaChart equity curve (realized+unrealized over time),
    gradient fill, color flips green/red by sign, live tooltip.
  - detected-pools.tsx: live pool feed with symbol/mint/age/liquidity/mcap/5m-change,
    passed/filtered badge, per-row Snipe button (disabled until wallet connected),
    AnimatePresence row slide-in/out.
  - open-positions.tsx: live positions with entry/current SOL, multiplier progress
    bar (Progress), unrealized PnL badge + SOL amount, tx link, Sell button
    (green when in profit).
  - presets.tsx: 3 quick-apply preset buttons with active-state detection.
  - theme-toggle.tsx: dark/light toggle (Sun/Moon icons).

  page.tsx v2:
  - Replaced local useState with zustand store; composes all new components.
  - Layout: KPI row (4 cards) -> [settings+presets+control | equity chart (2/3)] ->
    [detected pools | open positions (1/2)] -> activity log (full width).
  - Activity log gains PnL column + Clear button; rows fade in via motion.tr.
  - Sticky header gains ThemeToggle button; sticky footer retained (mt-auto pattern).
  - Responsive: 2-col KPI on mobile -> 4-col desktop; main grid 1-col -> 3-col;
    pools/positions 1-col -> 2-col.
  - useEffect timers: tick every 2s (always on, drives PnL random walk + auto-TP);
    spawnPool every 3.5s (only when isRunning).

- Bug fixed during QA: zustand v5 + React 19 useSyncExternalStore infinite loop
  ("Maximum update depth exceeded" / "getServerSnapshot should be cached"). Root cause:
  selectKpis returns a new object literal each call -> Object.is always false ->
  infinite re-render. Fix: wrap with useShallow from 'zustand/react/shallow' so the
  derived object is shallow-compared (primitives), preventing the loop.

- Verified via agent-browser (fresh load after fix):
  - GET / 200, compile 8.4s, render 299ms, ZERO console errors/warnings.
  - Render: Solana Sniper heading, ThemeToggle, Connect Wallet, 3 presets, 4 settings
    inputs, Auto Mode switch, Start Auto Sniper, Snipe Now (disabled until wallet).
  - Interactions: Connect Wallet -> "Connected" + Snipe Now enabled; Start Auto Sniper
    -> "Stop Auto Sniper"; Auto Mode -> checked; pools spawned (4+ Snipe buttons);
    manual pool snipe -> "Position opened" (BOME, TREMP) with tx links; auto-snipe
    triggered; failed snipe -> "Snipe failed — race lost" (WIFHAT); filtered pool ->
    "Detected — skipped (filter margin)"; theme toggle -> DOM confirmed dark->light.
  - Open Positions card showed 2 live positions with Sell buttons + tx links (positions
    later auto-closed at target multiplier via tick() auto-take-profit).
  - Screenshots: download/dashboard-v2-desktop.png (1280x900), dashboard-v2-mobile.png
    (390x844).
- Lint: `bun run lint` clean (exit 0). eslint config ignores sniper/ CLI folder.
- Git: 2 commits ahead of origin (worklog update from prior cron + dashboard v2).
  Pushing as fast-forward.

Stage Summary:
- Dashboard v2 complete and pushing to GitHub main (commit 8643af3).
- The dashboard now has a real simulation engine (zustand store) driving live KPIs,
  an equity curve, a detected-pools feed, open positions with PnL tracking + auto-TP,
  settings presets, and a theme toggle — all with framer-motion polish.
- Still simulated (no real Solana RPC / wallet / Jupiter calls from the dashboard),
  but the state architecture is clean and ready to be wired to real API routes.

Current project status:
- Stable and feature-rich. The / route renders a comprehensive trading dashboard
  with live-updating KPIs, equity curve, pool feed, positions, and activity log —
  all driven by a zustand simulation engine. Zero console errors, responsive,
  dark/light theme. The sniper/ CLI (Jupiter swap + monitor stub) remains unwired
  to the dashboard.

Unresolved issues / risks / next-phase priorities:
- Dashboard is still simulated. Highest-value next step: wire to real backend via
  API routes (POST /api/snipe, /api/sell, GET /api/pools, GET /api/positions) that
  invoke sniper/jupiter.ts server-side, with a SIMULATION_MODE flag for no-key dev.
- Real wallet connection: integrate @solana/wallet-adapter-react (Phantom) so
  "Connect Wallet" actually connects and signs, instead of just toggling a boolean.
- sniper/monitor.ts is still a skeleton; flesh out real new-pool detection
  (onLogs instruction decoding, Yellowstone gRPC for speed).
- Dev server does NOT persist between Bash tool calls — the cron must start dev +
  run agent-browser in the SAME bash command (documented pattern in this worklog).
- GitHub token ghp_r4wt... is compromised and still active — user must revoke.
- The activity log uses motion.tr (framer-motion on table rows) with mount-fade
  only (removed layout/exit to avoid table+AnimatePresence bugs); could upgrade
  to a non-table layout for richer row animations if desired.
