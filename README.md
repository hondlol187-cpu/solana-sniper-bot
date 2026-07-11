# Next.js + Tailwind + shadcn/ui Starter

A production-ready Next.js 16 starter built with TypeScript, Tailwind CSS 4,
shadcn/ui (New York), Prisma (SQLite), and a curated set of libraries for
building modern web apps quickly.

## Tech Stack

| Concern         | Choice                                              |
| --------------- | --------------------------------------------------- |
| Framework       | Next.js 16 (App Router)                             |
| Language        | TypeScript 5                                        |
| Styling         | Tailwind CSS 4 + shadcn/ui (New York) + Lucide      |
| Database        | Prisma ORM (SQLite)                                 |
| Server state    | TanStack Query                                      |
| Client state    | Zustand                                             |
| Forms           | react-hook-form + zod                               |
| Auth            | NextAuth.js v4                                      |
| Charts          | Recharts                                            |
| Animation       | Framer Motion                                       |
| Markdown        | react-markdown + MDX Editor                         |
| AI / media SDK  | `z-ai-web-dev-sdk` (LLM, VLM, TTS, ASR, image/video) |

## Getting Started

```bash
# 1. Install dependencies
bun install

# 2. Configure environment
cp .env.example .env
#   then edit .env -> DATABASE_URL="file:./db/custom.db"

# 3. Create the SQLite database + Prisma client
bun run db:push
bun run db:generate

# 4. Start the dev server (http://localhost:3000)
bun run dev
```

## Scripts

| Script              | Description                                              |
| ------------------- | -------------------------------------------------------- |
| `bun run dev`       | Start Next.js dev server on port 3000                    |
| `bun run build`     | Production build (standalone output)                     |
| `bun run start`     | Run the production standalone server                     |
| `bun run lint`      | Run ESLint                                               |
| `bun run db:push`   | Push Prisma schema to the database                       |
| `bun run db:generate` | Regenerate the Prisma Client                           |

## Project Structure

```
.
├── src/
│   ├── app/              # Next.js App Router (routes, layout, API)
│   ├── components/ui/    # shadcn/ui component library
│   ├── hooks/            # Custom React hooks
│   └── lib/              # Shared utilities + db client
├── prisma/               # Prisma schema
├── examples/             # Reference snippets (e.g. WebSocket)
├── mini-services/        # Optional standalone Bun services
└── public/               # Static assets
```

## Notes

- `.env`, `node_modules`, the local SQLite file (`db/custom.db`), and build
  output (`.next/`) are all gitignored — clone and run `bun run db:push` to
  regenerate the database.
- The project is configured for port 3000 only.

## License

MIT
