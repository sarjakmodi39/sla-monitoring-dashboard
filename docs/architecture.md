# Architecture

Reviewer-facing companion to the README — how the system fits together and why each piece is what it is. Written after the system was built, so it reflects what actually shipped, not the original plan (which targeted AWS Lambda before switching to Cloudflare Workers, and a direct Postgres connection before switching to Hyperdrive — both changes are explained below since they came from real problems, not preference).

## System diagram

```
┌─────────────────────────────┐
│  Browser                     │
│  React + Vite + TypeScript   │
│  (sla-monitoring-dashboard   │
│   .vercel.app)                │
└───────────────┬───────────────┘
                │  POST /upload   (raw CSV text)
                │  GET  /stats?from=&to=
                │  GET  /logs?from=&to=&service=&page=
                ▼
┌───────────────────────────────────────────┐
│  Cloudflare Worker                          │
│  (sla-dashboard-backend.<account>.workers.dev) │
│                                              │
│  fetch(request, env) — one script, routes    │
│  internally on method + pathname:            │
│    POST /upload → upload-handler             │
│    GET  /stats  → query-handler/stats        │
│    GET  /logs   → query-handler/logs         │
└───────────────┬───────────────────────────┘
                │  env.HYPERDRIVE.connectionString
                ▼
┌───────────────────────────────────────────┐
│  Cloudflare Hyperdrive                      │
│  (managed connection proxy — performs the    │
│   real TLS handshake to Postgres; the Worker  │
│   runtime's own TCP Socket API cannot, see    │
│   "Two real incidents" below)                 │
└───────────────┬───────────────────────────┘
                ▼
┌───────────────────────────────────────────┐
│  Supabase Postgres — `checks` table         │
│  unique (service_id, ts, agent)              │
└───────────────────────────────────────────┘
```

No separate API Gateway / router service exists — the Worker script itself is the HTTP endpoint Cloudflare routes requests to. Everything is stateless between requests; all state lives in Postgres.

## Components and responsibilities

### Backend (`backend/src/`)

| File | Responsibility |
|---|---|
| `worker/index.ts` | The actual Cloudflare Worker entrypoint (`fetch(request, env)`). Routes by method+pathname, adapts the Fetch API `Request`/`Response` to/from the handler functions below, does request-level validation (date format, page/page_size bounds), sets CORS headers, converts thrown errors to 400/500 JSON responses. |
| `upload-handler/parse.ts` | Pure functions: split raw CSV text into rows, detect/normalize epoch-vs-ISO timestamps, detect/normalize `s`-vs-`ms` latency units. No I/O. |
| `upload-handler/clean.ts` | Applies `parse.ts` to every row, decides which rows are unrecoverable (skipped) vs. cleaned-and-flagged, builds the `flags_summary` counts returned to the client. No I/O — this is the file you'd point to in an interview to explain the cleaning rules in isolation, with no Worker/DB context needed to follow it. |
| `upload-handler/index.ts` | Thin glue: calls `cleanBatch`, then `insertCleanedRows`, shapes the `/upload` response body. |
| `query-handler/stats.ts` | The `/stats` SQL: per-service uptime %, incident count (via a `lag()` window function over a deduped, 999-excluded, time-ordered set of checks), latency percentiles, check-failure counts, plus the overall breach summary. |
| `query-handler/logs.ts` | The `/logs` SQL: filtered (date range + optional service), paginated, parameterized (no string-built SQL — see the README's data findings for the injection-safety note). |
| `shared/db.ts` | `pg.Client` construction (one per request — not a pooled `Pool`, see below) and the batched multi-row `INSERT ... ON CONFLICT DO NOTHING` used by the upload path. |
| `shared/dateRange.ts` | Turns an optional `from`/`to` pair into a `[start, end)` UTC bound; a single date becomes "that whole day," not an instant. |
| `shared/types.ts` | Shared row/response shapes used across parse/clean/db so every consumer agrees on field names. |
| `shared/errors.ts` | Unwraps `AggregateError` (which `pg` sometimes throws) down to a real message, with a safe fallback string. |

### Frontend (`frontend/src/`)

| File | Responsibility |
|---|---|
| `App.tsx` | Owns all page state (date range, service filter, page number, stats/logs/upload state), fetches on mount and on filter change, wires the three panels together. |
| `api.ts` | The only file that knows the API's base URL and JSON shapes. `uploadCsv` uses `XMLHttpRequest` rather than `fetch` specifically so the UI can tell "upload finished, server processing" apart from "still sending bytes" — `fetch` has no equivalent signal. |
| `components/UploadPanel.tsx` | The dropzone, upload progress states (uploading/processing/done/error). |
| `components/StatsPanel.tsx` | Collapsible stats section — overall breach summary plus one severity-tiered card per service. |
| `components/LogsTable.tsx` | Filters (date range, service — built from the services `/stats` already returned, not hardcoded) + paginated raw log table. |

## Data flow: one upload, start to finish

1. User picks a CSV in the browser. `UploadPanel` reads it into memory and POSTs the raw text to `/upload` via `XMLHttpRequest`.
2. The Worker's `fetch` handler reads the request body as text and calls `handleUpload`.
3. `cleanBatch` (pure, no I/O) parses every line, normalizes timestamps/latency units, flags data-quality issues, and drops rows missing a required field — producing a list of cleaned rows plus counts.
4. `insertCleanedRows` batches those rows into Postgres in chunks of 1000 (Postgres has a 65,535 bound-parameter limit per query; at 9 params/row that's the largest safe chunk), via `INSERT ... ON CONFLICT (service_id, ts, agent) DO NOTHING` — so exact duplicates (including a full re-upload of the same file) insert zero new rows instead of erroring or duplicating.
5. The Worker returns `{ rows_received, rows_inserted, rows_duplicate, rows_skipped, flags_summary }`; the frontend shows it as a banner and immediately re-fetches `/stats` and `/logs` so the dashboard reflects the new data without a manual refresh.
6. `/stats` and `/logs` are plain read queries against the same `checks` table — no caching layer, every dashboard load re-aggregates from the live data.

## Why each technology choice

**React + Vite + TypeScript, on Vercel.** One language across the whole stack (the backend is also TypeScript) makes the shared type definitions in `shared/types.ts` and the frontend's `api.ts` types easy to keep in sync by hand, since there's no cross-language boundary to translate across. Vercel's GitHub integration auto-deploys `master` on every push, which satisfies "live URL, reachable" with no manual deploy step for ordinary changes.

**Cloudflare Workers over AWS Lambda.** The assignment requires a real deployed stateless function; it explicitly lists Cloudflare Workers as an accepted platform. I had no AWS account and didn't want to create one just for this exercise. A Worker is also simpler to reason about than Lambda+API Gateway: the Worker script itself receives the HTTP request directly, no separate routing resource to configure and keep in sync.

**Postgres via Supabase, through Hyperdrive.** SQL makes the two query shapes this app needs — per-service aggregates with a window-function incident count, and a filtered/paginated log listing — natural to write and to explain line-by-line. A key-value or single-table NoSQL store would push that aggregation logic into application code instead, which is harder to verify correct and slower to iterate on than SQL. Hyperdrive specifically (rather than a raw `pg` connection from the Worker) exists because the Workers runtime's TCP Socket API cannot complete a TLS handshake against Supabase's connection pooler — a real, reproduced platform bug, not a preference. See "Two real incidents" below.

**`pg.Client` per request, not a pooled `Pool`.** Workers execute each request in its own isolate with request-scoped I/O — a module-level `Pool` meant to be reused across requests silently breaks after the first request in a given isolate (confirmed via a whole-branch code review, not assumed). Hyperdrive itself provides the actual connection pooling on Cloudflare's side, so a per-request `Client` here is correct, not wasteful.

## Two real incidents, and how they were actually diagnosed

Both are documented in more detail in the README's Architecture section and git history; summarized here because they materially shaped the design:

1. **The AWS→Cloudflare platform switch** happened before any deploy, purely because I didn't have an AWS account — a scope/access decision, not a bug.
2. **The Hyperdrive switch happened *after* the first real deploy failed in production**, with `/stats`/`/logs` returning `"Connection terminated unexpectedly"`. I didn't guess at fixes — I wrote a temporary diagnostic route that spoke raw Postgres wire-protocol bytes over `cloudflare:sockets`, which proved TCP and Postgres's own SSL negotiation both succeeded, and that the failure was specifically in the Workers runtime's TLS handshake itself, before any of my code ran. That's what led to Hyperdrive as the fix rather than, say, tweaking `pg`'s `ssl` options (which I tried first and which changed nothing — consistent with the failure being below the application layer).

## Testing

`clean.ts`/`parse.ts` are pure functions with no Worker/DB dependency, so they're unit-tested directly (Vitest) covering every row in the README's data-findings table. `db.ts`, `stats.ts`, `logs.ts` are tested against a mocked `pg` client — real correctness of the SQL itself was additionally verified by hand against the live Supabase database (see README). The frontend's `api.ts` is tested against a fake `fetch`/`XMLHttpRequest`; UI components don't have automated tests (visual/behavioral changes were verified with headless Playwright screenshots against a real dev server instead, not asserted as passing without looking). No CI pipeline exists — explicitly out of scope per the assignment.
