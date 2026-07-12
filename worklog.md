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
