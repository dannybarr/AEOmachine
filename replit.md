# AEO Intelligence

A full-stack Answer Engine Optimization platform for website assessment, prompt tracking, visibility research, strategy development, and evidence-backed audits.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server
- `pnpm --filter @workspace/aeo-platform run dev` — run the main platform
- `pnpm --filter @workspace/aeo-research run dev` — run the research dashboard
- `pnpm db:bootstrap` — initialize a fresh development database
- `pnpm db:migrate` — apply checked-in SQL migrations to an existing database
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — build all workspace packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Required env: `DATABASE_URL` — Postgres connection string
- Optional live-model env: `OPENAI_API_KEY` and `OPENAI_BASE_URL` — Requesty-compatible credentials and endpoint

## Stack

- pnpm workspaces, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod
- API codegen: Orval (from OpenAPI spec)
- Build: Vite frontends and esbuild API bundle

## Where things live

- `artifacts/aeo-platform` — primary React/Vite application
- `artifacts/aeo-research` — research dashboard
- `artifacts/api-server` — Express API, jobs, and test suites
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/api-client-react` and `lib/api-zod` — generated clients and schemas
- `lib/db` — Drizzle schema, bootstrap guard, and SQL migrations

## Architecture decisions

- The main platform is mounted at `/`; research is mounted at `/aeo-research/`; API traffic is mounted at `/api`.
- Live model work uses Requesty's OpenAI-compatible endpoint and exact registered model IDs.
- Background tracking, research, audits, and entity extraction run inside the persistent API process.
- The database bootstrap is intentionally fresh-only and refuses non-empty public schemas.

## Product

- Assess a company website and create a working AEO company profile.
- Manage prompts, simulations, visibility tracking, cited domains, and answer-engine signals.
- Research content gaps, communities, case studies, strategy actions, and website audits.
- Explore curated industry AEO evidence and platform research in the research dashboard.

## User preferences

- Preserve the uploaded source export's behavior and presentation exactly unless the user asks for changes.

## Gotchas

- The checked-in generated Zod file has known declaration-order typecheck failures documented in `README.md`; production builds pass.
- Live simulations and model-backed jobs remain unavailable without Requesty credentials.
- Do not run `pnpm db:bootstrap` against a database containing existing public objects.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
