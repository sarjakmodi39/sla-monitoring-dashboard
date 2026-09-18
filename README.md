# SLA Monitoring Dashboard

Upload health-check CSVs, clean/validate them in a real deployed serverless function, persist to Postgres, and review uptime/incidents/latency plus the raw logs on a single dashboard page.

**Live app:** https://sla-monitoring-dashboard-one.vercel.app
**Live API:** https://sla-dashboard-backend.sarjakmodi39.workers.dev
**Last verified live:** 2026-09-18

---

## 1. Architecture

```
Browser (React, Vercel)
   │  POST /upload   (raw CSV text body)
   │  GET  /stats?from=&to=
   │  GET  /logs?from=&to=&service=&page=
   ▼
Cloudflare Worker (single script, internal router)
   │  /upload → parse → validate → clean → batch INSERT
   │  /stats, /logs → query
   ▼
Cloudflare Hyperdrive (managed connection proxy)
   ▼
Supabase Postgres (checks table)
```

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite + TypeScript on **Vercel** | One language across the stack; Git-connected auto-deploy on every push satisfies "live URL" with minimal ceremony. |
| Serverless function | **Cloudflare Worker** (TypeScript, Fetch API) | The assignment requires a *real deployed* stateless function. I originally planned AWS Lambda, but had no AWS account and didn't want to create one purely for this — Cloudflare Workers is explicitly accepted by the problem statement, needs no credit card for its free tier, and the Worker itself is the HTTP endpoint (no separate API Gateway resource to configure). |
| Database | **Postgres via Supabase** | Free-tier hosted Postgres. SQL makes the date-range filtering and per-service aggregate stats (`/stats`) straightforward to write and reason about compared to a key-value store. |
| DB connection | **Cloudflare Hyperdrive**, not a direct connection | See below — this was a real bug, not a stylistic choice. |
| Deploy tooling | **Wrangler** (backend), **Vercel CLI** (frontend) | Official CLIs for each platform; both scriptable and non-interactive once authenticated. |

### Why Hyperdrive, specifically

The first real deploy failed: `/stats` and `/logs` returned `"Connection terminated unexpectedly"` against the live Supabase database, even though local testing (via plain Node, bypassing the Workers runtime) had confirmed the credentials and connectivity were fine. I root-caused it by writing raw Postgres-protocol bytes over `cloudflare:sockets` directly, bypassing the `pg` library entirely: TCP connect and Postgres's own `SSLRequest` negotiation both succeeded, but the Workers runtime's `socket.startTls()` call itself threw `"TLS Handshake Failed."` before any application code ran. That matches a known, currently-open Cloudflare platform issue ([workers-sdk#3366](https://github.com/cloudflare/workers-sdk/issues/3366)) — the Workers TCP Socket API's TLS implementation fails against some Postgres TLS certificate presentations, Supabase's pooler included. It isn't fixable from application code.

Cloudflare Hyperdrive exists specifically to solve this: it's a managed proxy that performs the real TLS connection to Postgres on Cloudflare's own infrastructure, and hands the Worker a connection through it instead. Free tier, no credit card, 100k queries/day. Switching to it required no changes to the actual query/business logic (`db.ts`, `stats.ts`, `logs.ts` are untouched) — only the one line in the Worker that seeds the connection string now reads `env.HYPERDRIVE.connectionString` instead of a raw secret.

### Why synchronous POST instead of an async upload

The provided CSVs are ≤1.2MB, well under a Worker's request body limit. A synchronous POST-and-wait is simpler to build, run, and explain than a presigned-upload + storage-event + async-status-polling pipeline. That async pattern is the right answer for much larger files — see "What I'd do differently" below.

---

## 2. Data findings

Every issue below was found by inspecting the raw CSVs directly (not told in advance), and is handled in `backend/src/upload-handler/parse.ts` / `clean.ts` before a row reaches the database.

| Finding | Rule applied | Why |
|---|---|---|
| Timestamp sometimes a raw Unix epoch (seconds) instead of ISO-8601 | Detected via `/^\d+$/` on the trimmed value, converted to a UTC ISO string | A monitoring agent apparently logs in two different formats depending on version/region. Silently trusting `Date.parse` on a numeric string would misinterpret it (or produce `Invalid Date`), so digits-only is checked first and converted explicitly. |
| `latency_unit` is `s` for some rows, `ms` for others | Converted `s` → `ms` (× 1000), one numeric `latency_ms` column stored, unit column dropped after normalization | Mixing units in aggregates (avg/p95 latency) would silently produce nonsense numbers otherwise — this has to be caught before any math happens on it, not in the dashboard layer. |
| Missing latency (empty cell) | Row kept (status code is still a valid signal), `latency_ms = NULL` | A missing latency reading doesn't mean the check didn't happen — status code and timestamp are still meaningful. Dropping the whole row would throw away real uptime data. |
| Negative latency (physically impossible) | Row kept, `latency_ms` set to `NULL` rather than trusting a corrupted number | A negative latency is clearly bad data, not a real measurement — nulling it (rather than e.g. `abs()`-ing it) avoids inventing a plausible-looking but fake number. |
| Exact duplicate rows (same service/timestamp/agent) | Handled entirely by a DB `unique (service_id, ts, agent)` constraint + `ON CONFLICT DO NOTHING` | Re-uploading the same file (or the same file appearing in a batch twice) is a very real scenario for a health-check pipeline; this makes the upload endpoint naturally idempotent without extra application logic. |
| Status code `999` | Not a real HTTP status. Treated as "the monitoring agent's own check failed to run," not "the service was down." Row is kept and stored as-is, but **excluded from the uptime denominator**; surfaced separately as `check_failures`. | Counting agent failures as downtime would make the SLA number a measure of the monitoring agent's reliability, not the service's. Real outages (5xx/4xx) remain fully counted. |
| Blank / non-numeric `status_code` | Row rejected outright (not silently coerced to `0`) | An earlier version let a blank status code parse to `0`, which then counted as "up" in the uptime math — a real correctness bug, caught in review and fixed by validating `/^\d+$/` on the trimmed field before parsing. |
| Row missing a required field (`service_id`, `service_name`, `agent`, `region`) or an unparseable timestamp | Row skipped entirely, counted in the upload response's `rows_skipped`, never inserted | There's no safe default for "which service was this," so these rows can't be repaired — they're excluded and the count is surfaced so nothing silently vanishes. |
| A secondary `agent-2` reporting alongside the dominant `agent-1` for the same service/region | Treated as a legitimate second, independent observation — the unique constraint is `(service_id, ts, agent)`, so two different agents checking the same service at the same timestamp both get kept | Real multi-agent monitoring setups genuinely have more than one vantage point; collapsing them would lose real signal (e.g. a regional outage one agent sees and another doesn't). |
| A single row can have more than one data-quality issue at once (e.g. epoch timestamp **and** negative latency) | Every applicable flag is counted in the upload response's `flags_summary`, even though only one flag is stored per row on `data_quality_flag` (latency issues take storage priority) | An earlier version only counted the single stored flag, undercounting `flags_summary` by ~26% against the true number of affected rows — caught in a whole-branch review and fixed. The stored per-row flag is a simplification for the logs table UI; the summary count is not. |

---

## 3. Assumptions

Anywhere the spec was ambiguous, here's the choice made and why:

- **What counts as an "incident."** Defined as a maximal contiguous run of non-999, non-2xx checks for a service, ordered by timestamp (`backend/src/query-handler/stats.ts`). A single failed check and a 3-hour outage both count as "1 incident" under this definition — I did **not** implement a gap-tolerance heuristic (e.g. "still one incident if checks recover within N minutes then fail again"), since the spec gives no signal on what that tolerance should be. This is the single assumption I'd revisit first with more information from the actual on-call team.
- **`downtime_minutes`** is computed as `down_checks × 15` (the fixed check interval), not from actual timestamp gaps between the first and last down-check of an incident. Simpler and matches the data's fixed 15-minute cadence; would need to change if checks weren't evenly spaced.
- **Which stats to show.** Per service: uptime %, whether it breaches the 99.9% SLA, incident count, downtime minutes, avg/p95 latency, and check-failure count — plus an overall "X of 5 services breaching SLA" summary. Chosen from the perspective of someone on-call or in billing: uptime and breach status answer "do I owe a credit," incident count and downtime answer "how bad," latency answers "is it currently healthy," and check failures are broken out separately so a flaky monitoring agent doesn't get mistaken for a flaky service.
- **UI severity tiers** (healthy / minor breach ≥99.5% / critical breach <99.5%) are a dashboard-only presentation choice, not part of the API — the API just reports `breaches_slo: boolean`. Added because every breaching service looked equally alarming otherwise; the 99.5% split is a judgment call, not from the spec.
- **The 999 convention and the 99.9% SLA threshold are hardcoded constants**, not configurable. Reasonable for a single-tenant take-home; see "what I'd do differently."
- **Sync POST over async upload** — covered under Architecture above.
- **Date-range filtering**: a single selected date expands to `[start, start+1 day)` in UTC rather than an exact-timestamp match (`backend/src/shared/dateRange.ts`), since "one day" clearly means "the whole day," not one instant.

---

## 4. Running / redeploying

### Live URLs (as of this README)

- Frontend: https://sla-monitoring-dashboard-one.vercel.app
- API: https://sla-dashboard-backend.sarjakmodi39.workers.dev

Both are on free tiers with no guaranteed uptime SLA of their own — if either is down at review time, redeploy with the commands below (both take under a minute).

### Prerequisites

- Node.js 20+
- A Cloudflare account (free, no card) with `wrangler` authenticated (`npx wrangler login`)
- A Vercel account (free, no card) with the Vercel CLI authenticated (`npx vercel login`)
- A Supabase project (free tier) with `backend/schema.sql` applied

### Backend (Cloudflare Worker)

```bash
cd backend
npm install
npm test              # 42 tests, no network/DB needed — pg is mocked
npm run typecheck
npm run lint

# one-time: point Hyperdrive at your Supabase connection string
npx wrangler hyperdrive create sla-dashboard-db --connection-string="<your-supabase-pooler-url>"
# paste the printed [[hyperdrive]] block into wrangler.toml

# one-time: apply the schema (reads DATABASE_URL from backend/.dev.vars)
npm run migrate

# deploy
npx wrangler deploy
```

Local dev: `npm run dev` runs `wrangler dev` against your real Supabase database (reads `backend/.dev.vars`, see `.dev.vars.example`). Note: on Windows, `wrangler dev`'s local Miniflare TCP-socket emulation has its own known limitation reaching a real Postgres server — this doesn't affect the actual deployed Worker (Hyperdrive is what talks to Postgres there), only local dev experience.

### Frontend (Vercel)

```bash
cd frontend
npm install
npm test
npm run typecheck
npm run lint

# .env.local (gitignored) for local dev:
echo "VITE_API_BASE_URL=https://sla-dashboard-backend.sarjakmodi39.workers.dev" > .env.local
npm run dev

# deploy (Root Directory must be set to "frontend" in Vercel project settings)
npx vercel --prod
```

The `VITE_API_BASE_URL` environment variable must also be set in the Vercel project's dashboard (Production + Preview) — it's baked into the build at compile time.

---

## 5. What I'd do differently with more time

- **Configurable gap-tolerance for incidents**, once there's a real answer to "how long can a service recover before we call it a new incident."
- **Async upload for large files**: S3-equivalent presigned upload + event-triggered function + a status-polling endpoint, instead of synchronous POST-and-wait. Not needed for these file sizes, but the given dataset explicitly warns real logs are messier and could be larger.
- **Move the `999` convention and the 99.9% SLA threshold** out of hardcoded constants into either a config row in the database or a query parameter, so different teams/services could have different thresholds.
- **Materialized/cached stats** instead of recomputing aggregates on every dashboard load, if data volume grew well past what a handful of CSV uploads produce.
- **Real byte-level upload progress** (currently: an honest two-stage "uploading" → "processing" indicator via `XMLHttpRequest`'s `upload.onload` event, not a percentage — a true percentage bar would need the same XHR approach plus `upload.onprogress`, which I judged not worth the complexity at these file sizes since the transfer itself is sub-second).
