# SLA Monitoring Dashboard — Design Spec

**Date:** 2026-09-16
**Context:** Take-home assignment (`problem_statement.md`), Full Stack Developer role. 6–8 hour budget. Must be explainable line-by-line in a follow-up discussion — this spec exists so the author can defend every decision, not just the code.

## 1. Goals / Non-goals

**Goals:** upload UI → real deployed serverless function → real database → single-screen dashboard (collapsible stats + filterable logs). Everything reachable at live URLs on free-tier infra. README documents architecture, data findings, assumptions, live URL, and future work.

**Explicitly out of scope** (per problem statement): authentication/accounts, multi-tenancy, CI pipelines.

**Additional deliverables requested by the user** (beyond the problem statement):
- `docs/architecture.md` — reviewer-facing architecture writeup (diagram, component responsibilities, data flow, why each tech was chosen).
- `docs/interview-qa.md` — anticipated interview questions with answers, referencing actual file paths/line numbers, so the author can rehearse defending specific lines of code.

## 2. Stack decisions (already approved)

| Layer | Choice | Why |
|---|---|---|
| Frontend | React + Vite + TypeScript, hosted on **Vercel** | Single language across the stack; git-connected auto-deploy satisfies "live URL" requirement with minimal ceremony. |
| Serverless function | **AWS Lambda** (Node.js/TypeScript) behind **API Gateway (HTTP API)** | Canonical, widely-recognized "real cloud serverless function"; generous perpetual free tier. |
| Database | **Postgres via Supabase** | Free-tier hosted Postgres reachable over a plain connection string from Lambda (no VPC networking like RDS requires). SQL makes date-range filtering and aggregate stats trivial to write and explain. |
| Deploy tooling (backend) | **AWS SAM** (`template.yaml`, `sam build && sam deploy`) | Official AWS tool, no third-party account, plain YAML that's easy to read line-by-line in an interview. |

## 3. Architecture

```
Browser (React, Vercel)
   │  POST /upload   (raw CSV bytes, multipart or text body)
   ▼
API Gateway (HTTP API)  ──▶  Lambda: upload-handler
   │                              parses → validates → cleans → bulk INSERT
   ▼
Supabase Postgres (checks table)
   ▲
   │  GET /stats?from=&to=        GET /logs?from=&to=&service=&page=
API Gateway  ──▶  Lambda: query-handler
   ▲
Browser (dashboard fetch calls)
```

Two Lambda functions share one API Gateway. Both are stateless — all state lives in Postgres. No server the author has to run or manage.

**Why synchronous direct-POST instead of S3 presigned-upload + event trigger:** files here are ≤1.2MB, well under API Gateway's 10MB payload limit. A synchronous POST-and-wait is simpler to build, run, and explain than presigned URL + S3 event + async status polling. That async pattern is the textbook answer for large files; it's called out under "what I'd do differently" rather than built, since this dataset doesn't need it.

## 4. Project structure

```
/frontend                  React + Vite + TS app (Vercel)
  src/
    components/UploadPanel.tsx
    components/StatsPanel.tsx
    components/LogsTable.tsx
    api.ts                 fetch wrappers to API Gateway
/backend
  /upload-handler
    index.ts               Lambda entry point (thin: request → clean() → db insert)
    clean.ts                pure functions: parse, detect+fix timestamp/unit, dedupe, flag
    clean.test.ts           unit tests for clean.ts (Vitest) — no AWS/DB needed to run these
    db.ts                   pg client + insert helper
  /query-handler
    index.ts               routes GET /stats and GET /logs
    stats.ts                SQL for per-service uptime/latency/incident aggregates
    logs.ts                 SQL for paginated filtered log query
  /shared
    types.ts                shared row/response types imported by both handlers
  template.yaml             SAM template: 2 Lambdas + HTTP API + env vars
  schema.sql                one-time table creation, run once against Supabase
/docs
  architecture.md
  interview-qa.md
README.md
```

Cleaning logic lives in pure, framework-free functions (`clean.ts`) specifically so the author can point to one file with no AWS/DB dependency and explain it in isolation.

## 5. Data model (Postgres)

```sql
create table checks (
  id                bigserial primary key,
  service_id        text not null,
  service_name      text not null,
  ts                timestamptz not null,
  status_code       int not null,
  latency_ms        numeric,              -- null if missing or was corrupted (negative)
  agent             text not null,
  region            text not null,
  data_quality_flag text,                 -- null | 'epoch_timestamp' | 'unit_converted' | 'negative_latency_nulled' | 'missing_latency'
  raw_line          text not null,        -- original CSV line, for traceability
  unique (service_id, ts, agent)
);
create index on checks (ts);
create index on checks (service_id, ts);
```

The `unique` constraint is the de-duplication mechanism (upsert with `ON CONFLICT DO NOTHING`) — exact duplicate rows and re-uploads of the same file are both handled by the same rule, which is a good interview talking point.

## 6. Data cleaning rules (applied in `clean.ts`, before insert)

| Finding | Rule | Flag stored |
|---|---|---|
| Timestamp sometimes raw Unix epoch seconds instead of ISO-8601 | Detect all-digit value, convert to UTC ISO timestamp | `epoch_timestamp` |
| `latency_unit` column is `s` for some rows, `ms` for others | Convert `s` → `ms`, store one numeric column, drop the unit column after normalization | `unit_converted` |
| Missing latency (empty cell) | Keep row (status code is still valid signal), `latency_ms = NULL` | `missing_latency` |
| Negative latency (impossible) | Row kept, `latency_ms` set to `NULL` rather than trusting a corrupted number | `negative_latency_nulled` |
| Exact duplicate rows | Handled by DB unique constraint on `(service_id, ts, agent)`, `ON CONFLICT DO NOTHING` | — |
| Status code `999` | Not a real HTTP status. Treated as "the monitoring agent's check itself failed," not "the service was down." Row is kept and stored as-is (status_code = 999) but **excluded from the uptime denominator** in stats queries; surfaced separately as a "check failures" count. Real outages (500/502/503) remain fully counted. | — (no flag column value; identified by `status_code = 999` directly in stats SQL) |
| Row fails to parse at all (missing required field like `service_id` or an unparseable timestamp) | Row is skipped entirely, counted in the upload response's `rows_skipped`, not inserted | — |
| A rare secondary `agent-2` reports alongside the dominant `agent-1` for the same service/region | Treated as a legitimate second observation, not a duplicate — the unique constraint is `(service_id, ts, agent)`, so two agents checking the same service at the same timestamp both get kept. Only exact same-agent duplicates collapse. | — |

Every row of this table becomes a README "Data findings" bullet with the same one-line why.

## 7. API contracts

**`POST /upload`**
- Body: raw CSV text (`Content-Type: text/csv`)
- Response 200: `{ rows_received, rows_inserted, rows_duplicate, rows_skipped, flags_summary: { epoch_timestamp: n, unit_converted: n, missing_latency: n, negative_latency_nulled: n } }`
- Response 400: `{ error: "..." }` on missing/wrong-shaped headers or empty body

**`GET /stats?from=YYYY-MM-DD&to=YYYY-MM-DD`**
- `from`/`to` optional; default to full range present in DB. Single-day = `from == to`.
- Response: `{ overall: {...}, by_service: [{ service_id, service_name, uptime_pct, breaches_slo (bool, <99.9%), incident_count, downtime_minutes, avg_latency_ms, p95_latency_ms, check_failures }] }`
- "Incident" = a maximal contiguous run of non-999, non-2xx checks for that service, ordered by `ts`.

**`GET /logs?from=&to=&service=&page=&page_size=`**
- Response: `{ rows: [...], total, page, page_size }`

## 8. Frontend UX

Single page. **Top:** collapsible stats panel (default expanded), one card per service plus an overall summary, SLA-breach services visually flagged. **Below:** logs table — one date-range control (single date is `from === to`), optional service dropdown, paginated table showing raw + cleaned fields and the `data_quality_flag`, so a reviewer can see cleaning happened rather than take the README's word for it. **Separately:** an upload panel (drag/drop or file picker) that posts to `/upload` and shows the response summary (inserted/duplicate/skipped counts) as a toast or banner.

## 9. Error handling

- **upload-handler:** validates the CSV header row matches expected columns before processing; returns 400 with a clear message on mismatch or empty file. Per-row problems are cleaned/flagged, not rejected, except rows missing a required field, which are skipped and counted.
- **query-handler:** validates date params are parseable dates; 400 with message otherwise.
- **Frontend:** loading state during upload/query, error banner on non-2xx response, disabled upload button while a request is in flight.

## 10. Testing

Given "no CI pipelines" is explicitly out of scope, tests are run locally, not wired into a pipeline. `clean.ts` gets Vitest unit tests covering each row in the table in section 6 (epoch conversion, unit conversion, missing/negative latency, unparseable row) — chosen because it's pure logic, fast to test, and a natural thing to walk through line-by-line in an interview. No test infra beyond `npm test` is built.

## 11. Deployment / redeploy

- **Database:** create a free Supabase project via its web UI, run `backend/schema.sql` once in the Supabase SQL editor.
- **Backend:** `sam build && sam deploy --guided` first time (prompts for and stores the Supabase `DATABASE_URL` as a Lambda env var via SAM config, not committed to git); subsequent deploys are `sam build && sam deploy`.
- **Frontend:** Vercel project connected to the GitHub repo, auto-deploys on push to `main`; `VITE_API_BASE_URL` env var set in Vercel dashboard to the deployed API Gateway stage URL.
- **Secrets:** `DATABASE_URL` never committed — lives in `samconfig.toml` (gitignored) locally and as a stored SAM deploy parameter / Lambda env var in AWS. `.env.local` (gitignored) holds the same for local Lambda testing via `sam local`.

## 12. Deliverables checklist

- [ ] `README.md` — architecture, data findings, assumptions (including stats choices), live URL + redeploy steps, future work
- [ ] `docs/architecture.md` — standalone reviewer-facing architecture doc (diagram + narrative + why-each-piece), written after the system is built so it reflects what actually shipped
- [ ] `docs/interview-qa.md` — anticipated Q&A referencing real file paths/line numbers, written last, after code exists to point at
- [ ] Working live URLs for frontend and API, verified at submission time

## 13. What I'd do differently with more time (seed for README section)

- S3 presigned-upload + event-triggered Lambda for large files, with an async status-polling endpoint instead of synchronous POST-and-wait.
- Move the 999/"agent check failure" convention and SLA-breach threshold (99.9%) into configurable parameters instead of constants.
- Materialized/cached stats instead of computing aggregates on every dashboard load, if data volume grew.
