# Edward Jones | Client Product Insights

An internal platform demo for collecting, reviewing, and managing client feedback and product enhancement requests. Financial advisors, product managers, and operations teams use it to turn scattered client feedback into an organized, actionable product backlog.

It also provides a reliable **integration boundary** for a separate automation workflow (for example a Cursor automation that drafts Jira tickets): a signed outbound webhook and an authenticated Agent API with atomic claims. This application never creates Jira issues itself.

> **Demo environment • Synthetic client data.** Every household, advisor, branch, and figure is fictional. Seeded external references (`SAMPLE-1002`, `SAMPLE-1008`) and automation history are labeled as sample records and do not link to any issue tracker.

## What's included

| Area | What it does |
| --- | --- |
| **Overview** | Live metrics from the database: total, new, high-priority, and automation-involved requests; requests by product area × status; weekly submission volume; recent submissions and activity. |
| **Request queue** | Information-dense table with search (titles, feedback, households, advisors, tags), multi-select filters (status, priority, product area, type, automation status), sorting, pagination, empty states, and CSV export of the filtered results. |
| **Request detail** | Original feedback, problem statement, requested enhancement, workaround, business impact, client and household context, submitting advisor, owner, tags, related requests, internal notes, activity timeline, automation state, webhook delivery outcome, and external reference. Edit details, change status/priority/owner, add notes, and **Queue for automation**. |
| **Submit feedback** | Validated form with field guidance, household search, sensible defaults, and a clear confirmation. Rejects text that looks like Social Security or full account numbers. |
| **Clients & advisors** | Lightweight directory of 13 synthetic households and 7 advisors, linked from requests. |
| **Integrations** | Webhook URL, masked signing secret and API key (reveal, copy, rotate), enable/disable, auto-queue toggle, client-identity toggle, **Send test event**, delivery log with attempts, sanitized errors and manual retry, a built-in **mock receiver** inbox, and an API guide. |

Business status (New → Under Review → Planned → In Progress → Delivered / Declined) is owned by people. Automation status (Not Queued → Queued → Processing → Completed / Failed) is driven only by the queue action and the Agent API.

## Quick start

Requirements: Node.js 20.9 or newer (22 recommended).

```bash
npm install
cp .env.example .env.local    # optional; every value has a working default
npm run dev                   # http://localhost:4317
```

No database setup is needed locally: without `DATABASE_URL` the app runs **PGlite** (PostgreSQL compiled to WebAssembly), stores data in `.data/pglite`, applies migrations, and seeds 32 synthetic requests on first use.

The delivery worker starts inside the dev server automatically (`DELIVERY_WORKER_INLINE=true`).

### Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server on port 4317 with the inline delivery worker |
| `npm run build` | Production build, then `scripts/migrate.mjs` (applies `migrations/*.sql` when `DATABASE_URL` is set) |
| `npm start` | Production server (`PORT`, default 4317) |
| `npm test` | Vitest suite against an in-memory database |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:reset -- --confirm` | Wipe and reseed demo data (refuses when `DEMO_MODE=false`) |
| `npm run worker` | Standalone delivery worker (see below) |

## Data and storage

- **Schema:** [`migrations/001_init.sql`](./migrations/001_init.sql) — advisors, clients, team members, requests (with revision), relations, notes, activity events, automation jobs (claims and leases), webhook configuration, the delivery outbox, delivery attempts, and mock receiver events.
- **Local:** PGlite in `.data/pglite` (git-ignored). Only one process may open that directory; stop the dev server before running `npm run db:reset`, or reset from the app.
- **PostgreSQL:** set `DATABASE_URL` (and optionally `DATABASE_URL_UNPOOLED` for migrations behind a pooler). `npm run build` applies migrations; the app seeds demo data on first request when the database is empty and `SEED_ON_EMPTY=true`. The same SQL runs on both engines.
- **Production guard:** with `NODE_ENV=production` and no `DATABASE_URL`, the app refuses to start rather than write to an ephemeral filesystem (override only with an explicit `PGLITE_DATA_DIR` on a persistent volume).

## Demo session and security

- The interactive UI uses a **clearly identified demo session**: no sign-in, a session cookie, and a selectable persona (Jordan Ellis, Product Manager; Priya Raman, Operations Lead; Natalie Brooks, Product Owner) shown in the account menu. Actions are attributed to the selected persona in the activity timeline.
- When published on Cursor's app hosting (private or team), every UI endpoint also requires the **verified signed-in viewer** from the hosting gate (`cursor/identity.ts`). The account menu shows who is signed in. On a local dev server the helper supplies a simulated viewer (`cursor/identity.dev.ts`), so no sign-in is needed locally.
- State-changing UI endpoints require the session cookie, a same-origin request, and a double-submit CSRF token.
- Revealing or rotating the signing secret and API key is limited to the app owner or, on team apps, team admins.
- In production, webhook destinations must resolve to public IP addresses (localhost, private ranges, and cloud metadata hosts are rejected at save time and again at send time). Set `WEBHOOK_ALLOW_PRIVATE_NETWORKS=true` only for a private-network deployment.
- The Agent API (`/api/v1`) requires a bearer key. Keys and the signing secret are stored server-side, compared in constant time, masked in the UI, and redacted from logs and delivery errors.
- In a real deployment, put the UI behind your identity provider (SSO) and set `AGENT_API_KEYS` and `WEBHOOK_SIGNING_SECRET` from your secret manager.

## Resetting the demo

- **In the app:** account menu → **Reset demo data…** → type `RESET`. Available only when `DEMO_MODE` is not `false`. Integration settings and credentials are kept.
- **CLI:** `npm run db:reset -- --confirm` (stop the dev server first when using local PGlite).

## Delivery worker

Webhook deliveries live in a durable database outbox. The first attempt happens immediately when a request is queued; retries are processed by whichever of these is running (all are safe to run together, because due rows are claimed with `FOR UPDATE SKIP LOCKED`):

1. **Inline worker** inside the Next.js server (`DELIVERY_WORKER_INLINE=true`, every `DELIVERY_WORKER_INTERVAL_MS`). Ideal for `npm run dev` and long-running hosts.
2. **Standalone worker:** `APP_BASE_URL=https://insights.example.com AGENT_API_KEY=… npm run worker` calls `POST /api/v1/webhooks/dispatch` on an interval (`--once` for a single pass).
3. **Scheduler/cron** on serverless hosts: call `POST /api/v1/webhooks/dispatch` with the API key every minute.
4. **While viewing** the Integrations page or a request with a pending delivery, the browser nudges the dispatcher every 10 seconds.

Each pass also returns expired automation leases to the queue.

## Connecting an external automation workflow

Full details: [docs/API.md](./docs/API.md) and [docs/WEBHOOKS.md](./docs/WEBHOOKS.md). A sample payload is in [docs/sample-webhook-payload.json](./docs/sample-webhook-payload.json).

1. **Deploy to a reachable HTTPS URL** (see Hosting). Set `APP_BASE_URL` so payload links point at it.
2. **Create credentials:** set `AGENT_API_KEYS` and `WEBHOOK_SIGNING_SECRET`, or use the generated values on **Integrations → Connection**.
3. **Choose a trigger** supported by your automation environment:
   - **Webhook-triggered:** if your workflow platform gives you an inbound HTTPS trigger URL, paste it into **Webhook URL**, select **External webhook URL**, save, and **Send test event**. Verify `X-CPI-Signature` with the signing secret in the workflow (or in a small relay in front of it).
   - **Scheduled / polling:** if the workflow runs on a schedule or is started manually, have it call `POST /api/v1/automation/claim-next` (or `GET /api/v1/requests?automationStatus=queued` followed by `claim`). This works even when no webhook is configured.
4. **Process each request:** `claim` → read `GET /requests/{id}` → `automation-status` for progress → create the ticket in your tracker → `PUT external-reference` → `POST result` (`completed` or `failed`).
5. **Watch it work:** the request page shows the automation status, claim, progress, result, and the external issue key with a link.

Nothing in this app assumes a particular automation vendor or invents a vendor endpoint; the webhook is generic HTTPS and the API is plain REST.

### Exact configuration still required for a live integration

| Setting | Where | Value |
| --- | --- | --- |
| `DATABASE_URL` | host environment | Managed PostgreSQL connection string |
| `APP_BASE_URL` | host environment | Public HTTPS origin of this app |
| `AGENT_API_KEYS` | host secret | One or more long random keys; give one to the workflow |
| `WEBHOOK_SIGNING_SECRET` | host secret | 32+ random characters; give it to the workflow |
| Webhook URL | Integrations page or `WEBHOOK_URL` | The workflow's inbound HTTPS trigger, if it has one |
| Destination | Integrations page | **External webhook URL** |
| Scheduler (serverless only) | host cron | `POST /api/v1/webhooks/dispatch` every minute with the API key |
| `DEMO_MODE` | host environment | `false` outside demos |

## Hosting

- **The automation must be able to reach this app over the public internet via HTTPS.** `localhost` is not reachable from a hosted workflow, and a deployment behind an interactive sign-in page (including private or team-only app hosting) blocks API calls from automation. Use a deployment where `/api/v1/*` is reachable with bearer authentication, or expose it through an API gateway.
- **Outbound webhooks** need the reverse: the workflow's trigger URL must be reachable from this app.
- **Persistent state must live in PostgreSQL** (Neon, Supabase, RDS, Cloud SQL, …). Do not rely on the local PGlite directory on serverless or container hosts with ephemeral disks.
- Any Node.js host works: Vercel or similar (add the dispatch cron), Render/Fly/containers (`npm run build && npm start`; the inline worker handles retries).
- For local experiments with a hosted workflow, a tunnel (for example `cloudflared` or `ngrok`) can expose `http://localhost:4317` over HTTPS temporarily.

## Demo walkthrough

1. **Overview.** Point out total, new, high-priority, and automation metrics, then the product-area × status bars (Client Portal and Advisor Workstation lead demand) and the recent activity feed.
2. **Filter the queue.** Request queue → Priority: High, Request type: Enhancement. Show search, chips, sorting, and **Export CSV**.
3. **Open a request.** For example `CPI-1001` (household performance reporting) or `CPI-1007` (beneficiary update status). Walk through the original client quote, problem, requested enhancement, workaround, business impact, household context (segment, tenure), advisor, related requests, notes, and timeline. Change the owner or status and show the new timeline entry.
4. **Submit new feedback.** Submit feedback → fill in the form → **Submit**. Open the new request from the confirmation; it is also on the queue and dashboard.
5. **Queue for automation.** Select **Queue for automation**. The toast and Automation panel show the queued revision and the delivery outcome. Click again to show idempotency ("Already queued").
6. **Show the delivery.** Integrations → Delivery log (payload, signature-verified attempts) and Mock receiver (received event, headers with signature redacted). Optionally switch on **Simulate mock receiver outage**, queue another request, and show retries and **Retry**.
7. **Claim and complete via the API.** Copy the Agent API key from Integrations and run the curl commands from **Integrations → API guide** (claim, automation-status, external-reference, result). A second claim returns `409 already_claimed`.
8. **Show the result.** Reload the request: automation status **Completed**, the result summary, the external reference link, and the full automation history in the timeline.

## Design decisions

- **Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 + shadcn/ui.** Server components read the database directly; mutations go through route handlers with consistent JSON errors.
- **PostgreSQL everywhere** (PGlite locally) instead of SQLite, so the same SQL, locking (`FOR UPDATE SKIP LOCKED`), and partial unique indexes run in development and production.
- **Idempotent queueing** uses a partial unique index on `(request_id, revision)` for active jobs plus a row lock on the request.
- **Atomic claims** use a single conditional `UPDATE … RETURNING` with leases; expired leases are released by the worker and at claim time.
- **Revisions** increment on every human edit; the UI uses them for optimistic concurrency (`409 revision_conflict`), and automation results report whether the request changed after it was queued.
- **The mock receiver** runs in-process by default so the demo works on any host, and is labeled as simulated everywhere. A real HTTP round trip is one setting away.
- **Fonts are self-hosted** (`@fontsource-variable/inter`, `source-serif-4`) so builds do not depend on external font CDNs.

## Project structure

```
migrations/            SQL schema (applied by PGlite locally and scripts/migrate.mjs in production)
scripts/               migrate.mjs, reset-demo.ts, worker.mjs
docs/                  API reference, webhook contract, sample payload and test vector
src/app/(app)/         Pages: overview, requests, clients, advisors, integrations
src/app/api/           UI endpoints (session + CSRF) and /api/v1 Agent API (bearer)
src/lib/server/        Database, requests, automation, webhooks (signing, outbox, mock receiver), seed
src/components/app/    Application components; src/components/ui holds shadcn/ui primitives
tests/                 Vitest suites
```

## Tests

```bash
npm test
```

Covers request creation and validation (including sensitive-data rejection and CSRF), idempotent queueing and revision supersession, webhook signatures (format, tampering, replay window, rotation), external delivery with retries that preserve the event ID, exhaustion and manual retry, non-retryable 4xx, sanitized network errors, mock receiver labeling, Agent API authentication, concurrent claim protection (one winner out of six), `claim-next` distribution, idempotent results, stale-claim rejection after lease expiry, and superseded revisions.
