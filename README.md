# AEO Intelligence source export

This is a neutral, self-contained source export of the AEO Intelligence
platform: the primary web application, research dashboard, API, shared clients
and schemas, PostgreSQL schema and migrations, and automated tests.

**Known baseline check failure:** `pnpm typecheck` currently reports 86
declaration-order errors in the generated file
`lib/api-zod/src/generated/api.ts` (TS2448/TS2454). The exported error list is
identical to the source workspace baseline. Production builds pass, but consumers
should treat this as known generated-code debt rather than a clean typecheck.

**Known baseline test failure:** against a fresh PostgreSQL 16 database,
`pnpm test` currently exits 1 with 60 of 62 Node-runner tests passing.
`actionEvidence.test.ts` and `strategyBrief.test.ts` fail during initialization
on the same generated-schema declaration-order bug at
`lib/api-zod/src/generated/api.ts:2067`. Because the API test command chains
Vitest with `&&`, Vitest is not reached. Running the original source baseline in
the same disposable environment produces the identical 60/62 result.

The archive contains no private production/customer records, database dumps,
credentials, deployment metadata, uploaded files, design canvases, dependency
folders, generated builds, agent state, or source-control history.

## Requirements

- Node.js `>=20.19 <21` or `>=22.12` (the minimum supported by Vite 7)
- pnpm `10.26.1` (pinned by the root `packageManager` field)
- PostgreSQL 16 (PostgreSQL 14+ should also work)

## Install

```sh
corepack enable
corepack prepare pnpm@10.26.1 --activate
pnpm install --frozen-lockfile
cp .env.example .env
```

Edit `.env` with a PostgreSQL URL and secure random operator/session values.
The example contains no working credentials. Environment files are ignored and
are not part of the ZIP.

## Initialize a new database

Create an empty PostgreSQL database, load your environment, then run:

```sh
set -a; . ./.env; set +a
pnpm db:bootstrap
```

`db:bootstrap` is deliberately fresh-only. It refuses to run when the target
database's `public` schema already contains any table, partitioned table, view,
materialized view, sequence, foreign table, or enum. Only after proving
`public` is empty does it use forced Drizzle synchronization to create the
current schema, then apply checked-in SQL migrations in lexical order. The
forced operation is therefore never run against an existing populated schema.
For an existing installation, review and back up the database before running
`pnpm db:migrate`. Nothing in `scripts/post-merge.sh` modifies a database.

## Requesty model routing

Live model work is implemented against Requesty's OpenAI-compatible router. Use
credentials from **your own Requesty account**:

```env
OPENAI_BASE_URL=https://router.requesty.ai/v1
OPENAI_API_KEY=your-own-requesty-token
```

The historical environment variable name is `OPENAI_API_KEY`, but its value is
a Requesty token when the Requesty base URL is configured. This export includes
no token and grants no authorization to make model/provider calls. Starting the
API with valid credentials can incur charges.

The checked-in registry currently requests these exact Requesty model IDs:

- `openai/gpt-5`
- `openai/gpt-5-mini`
- `anthropic/claude-sonnet-4-5`
- `google/gemini-2.5-flash`
- `perplexity/sonar`
- `xai/grok-4-fast-non-reasoning`
- `moonshot/kimi-k3`
- `deepinfra/meta-llama/Llama-3.3-70B-Instruct`

On API boot, the registry compares these IDs with Requesty's `/models` response
and visibly disables missing IDs; it never silently substitutes a model.
Simulation requests remain streamed and use Requesty's `web_search` tool where
supported. Citation eligibility and URLs come only from provider-attached
stream metadata (`annotations[].url_citation` or `web_search.content[]`), with
diagnostics preserved for malformed or changed metadata shapes. Do not replace
this with prose URL scraping if metric comparability matters.

## Development and route layout

Load `.env`, then start these long-running processes in separate terminals:

```sh
pnpm dev:api       # API: http://localhost:3000
pnpm dev:research  # Research: http://localhost:5174/aeo-research/
pnpm dev:platform  # Platform: http://localhost:5173
```

Both frontends proxy `/api` to `API_PROXY_TARGET` (default
`http://localhost:3000`). The research app is built with base
`/aeo-research/`. The main platform Vite server proxies that path to
`RESEARCH_PROXY_TARGET` (default `http://localhost:5174`), so a platform link to
`/aeo-research/` works through the main origin while the research dev process is
running. In production, serve the research build at the same base path and the
platform at `/`.

Do not put a shared `PORT` in `.env`: every process would inherit it and collide.
The example intentionally omits `PORT`. The API defaults to 3000, the platform
to 5173, and research to 5174. To override one service, set `PORT` only on that
command, for example `PORT=35173 pnpm dev:platform`.

### First company and prompt

1. Open the platform and use **Add company…** in the company selector (or the
   Settings screen) to create the first company and website.
2. Open **All prompts**, add the first customer question, and associate it with
   that company.
3. Read-only setup works without Requesty. Running simulations, tracking,
   discovery, entity extraction, case-study research, or website assessments
   requires your configured Requesty account and may spend provider credits.

## Process and job lifecycle

Keep the API process running for background work. At boot it validates the model
registry, starts the answer-entity extraction worker, and starts the daily
tracking scheduler. The scheduler checks every 15 minutes (and once shortly
after boot), only tracks companies with daily tracking enabled, and uses
database guards to avoid duplicate scheduled batches.

Tracking, gap research, case-study research, website assessments, and entity
extraction are asynchronous jobs owned by the API process. A restart marks
orphaned running jobs failed or requeues recoverable entity extraction work.
The scheduler and worker timers are not a separate queue service; if the API is
stopped, they do not run. For production, supervise the API as a persistent
service and use one scheduler-active instance unless you have validated the
database concurrency guards for your topology.

## Build, check, and test

```sh
pnpm build
pnpm typecheck
pnpm test
```

`pnpm build` executes every workspace package's real build script. Frontend
output goes to each frontend's `dist/public`; API output goes to
`artifacts/api-server/dist`.

`pnpm test` is not a placeholder: pnpm recursively executes package test scripts,
including the API server's Node test runner (`tsx --test src/lib/*.test.ts`) and
Vitest suite (`vitest run`). Tests that exercise persistence require an
isolated, freshly bootstrapped test database; never point tests at production.
Without `DATABASE_URL`, the suite starts and reports 36 passing Node tests,
while six DB-importing test files fail immediately on the explicit
missing-database guard. With a fresh PostgreSQL 16 database, 60 of 62 Node tests
pass; the two remaining files hit the generated-schema initialization defect
described at the top of this README. In both cases the chained Vitest phase does
not run because the Node phase exits nonzero.

## Security and production warning

This codebase does **not** yet provide complete end-user authentication or
tenant authorization. Operator-token checks cover selected maintenance routes
only, and the API currently enables broad CORS. Do not expose the API or either
frontend directly to the public internet as a multi-user service. Until the
separate access-control work is complete, place the deployment behind trusted
network controls and an authenticated reverse proxy, restrict CORS, and use a
dedicated least-privilege database role.

Keep `DATABASE_URL`, Requesty credentials, and operator/session secrets in a
secret manager. Never bake them into frontend builds. Route `/api` to the API,
serve `/aeo-research/` from the research build, apply reviewed migrations before
starting a new API version, and back up production data first.

## Package layout

- `artifacts/aeo-platform` — primary React/Vite application
- `artifacts/aeo-research` — research React/Vite dashboard
- `artifacts/api-server` — Express API and automated tests
- `lib/api-client-react` — generated React Query API client
- `lib/api-zod` — shared request/response schemas
- `lib/api-spec` — API client/schema generation tooling
- `lib/db` — Drizzle schema, bootstrap guard, and SQL migrations
- `scripts` — workspace maintenance scripts