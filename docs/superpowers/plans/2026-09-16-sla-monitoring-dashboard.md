# SLA Monitoring Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a full-stack SLA monitoring dashboard: CSV upload UI → AWS Lambda cleaning/validation function → Postgres persistence → single-screen dashboard (collapsible stats + filterable logs).

**Architecture:** React (Vite/TS) frontend on Vercel calls a single API Gateway HTTP API fronting two AWS Lambda functions (Node/TS): `upload-handler` (parses/cleans/inserts) and `query-handler` (stats + logs). Postgres on Supabase is the persistence layer. All cleaning logic is pure/testable functions with no AWS or DB dependency.

**Tech Stack:** TypeScript everywhere. Backend: AWS SAM, Lambda (nodejs20.x), `pg`, Vitest. Frontend: React 18, Vite, Vitest. Deploy: AWS SAM CLI, Vercel CLI.

**Spec:** `docs/superpowers/specs/2026-09-16-sla-monitoring-dashboard-design.md` — this plan implements that spec; read both.

## Global Constraints

- Free-tier / no-cost resources only — nothing requiring a paid plan.
- Do NOT build authentication, multi-tenancy, or a CI pipeline — explicitly out of scope.
- The upload-processing function must be a real deployed AWS Lambda — not run locally or in a container standing in for one.
- Persisted data must be re-queryable from Postgres after upload finishes — never held only in memory.
- De-duplication key is `(service_id, ts, agent)` via a DB unique constraint + `ON CONFLICT DO NOTHING`.
- Status code `999` = the monitoring agent's check failed to run; excluded from the uptime denominator. Any status `>= 400` (and `!= 999`) counts as "down."
- Every data-cleaning rule implemented must map to a README "Data findings" bullet with a one-line why.
- Commit after every task — the assignment says commit history is read.

---

## Amendment (2026-09-17): Cloudflare Workers replaces AWS Lambda

The author has no AWS account and doesn't want to create one. Cloudflare
Workers is explicitly accepted by the problem statement, needs no credit
card for its free tier, and only the outermost platform-adapter layer
changes — `clean.ts`, `db.ts`, `stats.ts`, `logs.ts`, `dateRange.ts`, and
every test already written for them are **completely unaffected** and
need no rework. See the design spec's 2026-09-17 amendment for the
updated architecture diagram and stack table.

This supersedes parts of Tasks 6 and 9 (already implemented under the old
Lambda shape) and replaces Tasks 10, 12, and 13 outright. Tasks 14-24 need
no functional change — wherever they say "API Gateway URL" or "deployed
API", read it as "the deployed Worker's URL"; the API contracts, response
shapes, and frontend code are identical regardless of which cloud platform
serves them.

### Amendment to Task 6 (upload-handler)

Remove the Lambda-shaped `handler` export and its test from
`backend/src/upload-handler/index.ts` / `index.test.ts` — the
`@types/aws-lambda`-typed `APIGatewayProxyEventV2` wrapper and its
base64-decoding logic are no longer needed (a Cloudflare Worker receives a
standard Fetch API `Request`, whose `.text()` already gives the raw body
with no base64 concern). **Keep `handleUpload(csvText, insert?)` and its
three existing tests completely unchanged** — the new Worker (Task
10-replacement below) calls `handleUpload` directly.

### Amendment to Task 9 (query-handler router)

Delete `backend/src/query-handler/index.ts` and
`backend/src/query-handler/index.test.ts` entirely — this Lambda-shaped
router is fully superseded by the new Worker's routing (Task 10-replacement
below), which does the same path-based dispatch but adapts `Request`/
`Response` instead of API Gateway's event shape. `stats.ts` and `logs.ts`
(and their tests) are untouched.

### Task 10-replacement: Cloudflare Worker entrypoint

**Files:**
- Create: `backend/src/worker/index.ts`
- Test: `backend/src/worker/index.test.ts`
- Create: `backend/wrangler.toml`
- Delete: `backend/template.yaml` (superseded)

**Interfaces:**
- Consumes: `handleUpload` from `../upload-handler/index`, `getServiceStats` from `../query-handler/stats`, `getLogs` from `../query-handler/logs`.
- Produces: a Cloudflare Worker default export (`fetch(request, env)`) — this is what Wrangler deploys.

- [ ] **Step 0: Add DOM types so `Request`/`Response`/`URL` type-check**

`backend/tsconfig.json` currently has `"lib": ["ES2022"]`, which doesn't
include the Fetch API types this Worker needs. Change that line to:

```json
    "lib": ["ES2022", "DOM"],
```

This only affects type-checking (Node and the Workers runtime both provide
these globals already); it doesn't change any runtime behavior. Run `cd
backend && npm run typecheck` after this one-line change — expect it to
still pass cleanly (no other file references anything DOM-specific).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../upload-handler/index', () => ({ handleUpload: vi.fn() }));
vi.mock('../query-handler/stats', () => ({ getServiceStats: vi.fn() }));
vi.mock('../query-handler/logs', () => ({ getLogs: vi.fn() }));

import worker from './index';
import { handleUpload } from '../upload-handler/index';
import { getServiceStats } from '../query-handler/stats';
import { getLogs } from '../query-handler/logs';

const env = { DATABASE_URL: 'postgres://test' };

describe('worker fetch', () => {
  it('routes POST /upload to handleUpload with the request body text', async () => {
    (handleUpload as any).mockResolvedValue({ statusCode: 200, body: { rows_received: 1 } });
    const req = new Request('https://worker.example/upload', { method: 'POST', body: 'a,b\n1,2' });
    const res = await worker.fetch(req, env as any);
    expect(handleUpload).toHaveBeenCalledWith('a,b\n1,2');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows_received: 1 });
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('routes GET /stats with parsed query params', async () => {
    (getServiceStats as any).mockResolvedValue({ overall: {}, by_service: [] });
    const req = new Request('https://worker.example/stats?from=2025-05-01&to=2025-05-02');
    const res = await worker.fetch(req, env as any);
    expect(getServiceStats).toHaveBeenCalledWith('2025-05-01', '2025-05-02');
    expect(res.status).toBe(200);
  });

  it('routes GET /logs with parsed pagination', async () => {
    (getLogs as any).mockResolvedValue({ rows: [], total: 0, page: 2, page_size: 25 });
    const req = new Request('https://worker.example/logs?service=svc-auth&page=2&page_size=25');
    const res = await worker.fetch(req, env as any);
    expect(getLogs).toHaveBeenCalledWith({ from: undefined, to: undefined, service: 'svc-auth', page: 2, pageSize: 25 });
    expect(res.status).toBe(200);
  });

  it('returns 404 for an unknown route', async () => {
    const req = new Request('https://worker.example/nope');
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(404);
  });

  it('returns 400 when a downstream call throws', async () => {
    (getServiceStats as any).mockRejectedValue(new Error('boom'));
    const req = new Request('https://worker.example/stats');
    const res = await worker.fetch(req, env as any);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'boom' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/worker/index.test.ts`
Expected: FAIL — `./index` (worker) module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { handleUpload } from '../upload-handler/index';
import { getServiceStats } from '../query-handler/stats';
import { getLogs } from '../query-handler/logs';

export interface Env {
  DATABASE_URL: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    process.env.DATABASE_URL = env.DATABASE_URL;
    const url = new URL(request.url);

    try {
      if (request.method === 'POST' && url.pathname === '/upload') {
        const csvText = await request.text();
        const result = await handleUpload(csvText);
        return json(result.statusCode, result.body);
      }
      if (url.pathname === '/stats') {
        const data = await getServiceStats(
          url.searchParams.get('from') ?? undefined,
          url.searchParams.get('to') ?? undefined,
        );
        return json(200, data);
      }
      if (url.pathname === '/logs') {
        const data = await getLogs({
          from: url.searchParams.get('from') ?? undefined,
          to: url.searchParams.get('to') ?? undefined,
          service: url.searchParams.get('service') ?? undefined,
          page: Number(url.searchParams.get('page') ?? '1'),
          pageSize: Number(url.searchParams.get('page_size') ?? '50'),
        });
        return json(200, data);
      }
      return json(404, { error: `Unknown route: ${url.pathname}` });
    } catch (err) {
      return json(400, { error: (err as Error).message });
    }
  },
};
```

Note: `backend/src/shared/db.ts`'s `getPool()` reads `process.env.DATABASE_URL` — setting it from `env.DATABASE_URL` at the top of `fetch` (Workers pass config via the `env` parameter, not real process env vars) makes that existing, already-tested code work unchanged on Workers. This is the only place any previously-written file's *behavior* depends on the new platform, and it requires no edit to `db.ts` itself.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/worker/index.test.ts`
Expected: all PASS.

- [ ] **Step 5: Write `backend/wrangler.toml`**

```toml
name = "sla-dashboard-backend"
main = "src/worker/index.ts"
compatibility_date = "2024-09-01"

[observability]
enabled = true
```

(`DATABASE_URL` is deliberately absent from this file — it's set via `wrangler secret put DATABASE_URL`, a manual step, so it's never committed.)

- [ ] **Step 6: Delete the superseded files**

```bash
git rm backend/template.yaml
```

- [ ] **Step 7: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all tests pass (the amended Task 6/9 removals plus this new worker test file).

- [ ] **Step 8: Commit**

```bash
git add backend/src/worker/index.ts backend/src/worker/index.test.ts backend/wrangler.toml
git commit -m "feat: add Cloudflare Worker entrypoint, replacing Lambda handlers"
```

### Task 12-replacement (MANUAL — requires your own free Cloudflare account): Install and configure Wrangler

- [ ] **Step 1:** Sign up free at dash.cloudflare.com — no credit card required for the Workers free tier.
- [ ] **Step 2:** `npm install -g wrangler` (or run via `npx wrangler` each time, no global install needed).
- [ ] **Step 3:** `wrangler login` — opens a browser to authenticate.
- [ ] **Step 4:** Verify: `wrangler whoami` should show your account.

### Task 13-replacement (MANUAL — first deploy needs your login): Deploy the backend

- [ ] **Step 1:** From `backend/`, set the database secret (paste your Supabase connection string from Task 11 when prompted):

```bash
wrangler secret put DATABASE_URL
```

- [ ] **Step 2:** Deploy:

```bash
wrangler deploy
```

Expected output includes a URL like `https://sla-dashboard-backend.<your-subdomain>.workers.dev` — save it, every later task that said "API Gateway URL" means this.

- [ ] **Step 3:** Smoke-test:

```bash
curl -X POST "<worker-url>/upload" -H "Content-Type: text/csv" --data-binary @../monitoring_checks_9d_seed101.csv
```

Expected: a JSON response with `rows_received`, `rows_inserted`, etc.

### Amendment to Task 24 (interview Q&A)

Question 9 becomes: "Why was a synchronous POST-to-Worker chosen over an object-storage presigned-upload + event trigger, given the files are CSVs that could in principle be large?" — everything else about that answer (file size vs. limit, simplicity trade-off) still applies, just naming Cloudflare's request-body limit instead of API Gateway's.

Add a new question 16: "Why Cloudflare Workers over AWS Lambda for this project?" — answer should cite: no credit card needed for the free tier (a real constraint, not just a preference), the assignment explicitly accepting it, single-script deployment with no separate API-Gateway-equivalent resource to configure, and that the swap only touched `backend/src/worker/index.ts` + `wrangler.toml` — every pure business-logic file and its tests were unaffected, which is itself worth being able to explain (it demonstrates the platform-adapter boundary was designed correctly the first time).

## Amendment (2026-09-17, second): ESLint + Lefthook, at the author's request

The author asked for linting and a git-hooks tool, explicitly citing that this is local tooling, not a CI pipeline (the assignment excludes hosted CI, not local pre-commit checks). Two new tasks, inserted after the Cloudflare Worker amendment above and before Task 11 in execution order (so linting exists before the remaining backend/frontend work continues, and covers everything already written on the next commit).

### Task A: ESLint for the backend

**Files:**
- Create: `backend/eslint.config.js` (flat config, ESLint 9+)
- Modify: `backend/package.json` (add `lint` script + devDependencies)

**Interfaces:** none — tooling only, no code changes to existing files besides what autofix touches.

- [ ] **Step 1: Add devDependencies**

```json
    "@eslint/js": "^9.9.0",
    "eslint": "^9.9.0",
    "typescript-eslint": "^8.3.0"
```

(merge into `backend/package.json`'s existing `devDependencies`, keep alphabetical)

- [ ] **Step 2: Add `lint` script**

```json
    "lint": "eslint src"
```

(add to `backend/package.json`'s existing `scripts`, alongside `test`/`typecheck`/`dev`)

- [ ] **Step 3: Write `backend/eslint.config.js`**

```javascript
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
```

- [ ] **Step 4: Install and run**

Run: `cd backend && npm install && npm run lint`
Expected: may report real findings on existing code (e.g. unused vars) — fix any it finds by editing the flagged lines directly (don't disable rules to silence them unless a finding is a false positive you can justify in the report). Re-run until clean.

- [ ] **Step 5: Run the full test suite to confirm lint fixes didn't break anything**

Run: `cd backend && npm test`
Expected: same pass count as before this task.

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/eslint.config.js
git commit -m "chore: add ESLint to backend"
```

### Task B: ESLint for the frontend

Same shape as Task A, applied to `frontend/`, with the React plugin added:

**Files:**
- Create: `frontend/eslint.config.js`
- Modify: `frontend/package.json`

- [ ] **Step 1: Add devDependencies**

```json
    "@eslint/js": "^9.9.0",
    "eslint": "^9.9.0",
    "eslint-plugin-react-hooks": "^4.6.2",
    "typescript-eslint": "^8.3.0"
```

- [ ] **Step 2: Add `lint` script** (`"lint": "eslint src"`) to `frontend/package.json`'s `scripts`.

- [ ] **Step 3: Write `frontend/eslint.config.js`**

```javascript
const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
);
```

- [ ] **Step 4: Install and run**

Run: `cd frontend && npm install && npm run lint`
Expected: fix any real findings directly, re-run until clean.

- [ ] **Step 5: Run the full test suite and typecheck to confirm nothing broke**

Run: `cd frontend && npm test && npm run typecheck`

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/eslint.config.js
git commit -m "chore: add ESLint to frontend"
```

### Task C: Lefthook pre-commit hook

**Files:**
- Create: `lefthook.yml` (repo root)
- Modify: repo-root `.gitignore` (add a Lefthook-managed ignore if needed — Lefthook itself needs no ignore entry, it has no generated dir)

**Interfaces:** none — this only wires existing `npm run lint`/`npm test`/`npm run typecheck` scripts (already present in both `backend/` and `frontend/` after Tasks A/B) into a git hook. No application code changes.

- [ ] **Step 1: Write `lefthook.yml`** (repo root)

```yaml
pre-commit:
  parallel: true
  commands:
    backend-lint:
      root: "backend/"
      glob: "*.ts"
      run: npm run lint
    backend-typecheck:
      root: "backend/"
      glob: "*.ts"
      run: npm run typecheck
    frontend-lint:
      root: "frontend/"
      glob: "*.{ts,tsx}"
      run: npm run lint
    frontend-typecheck:
      root: "frontend/"
      glob: "*.{ts,tsx}"
      run: npm run typecheck
```

- [ ] **Step 2: Install Lefthook and activate the hook**

Run: `npm install -g @evilmartians/lefthook` (or, if a global install isn't wanted, `npx lefthook install` works too — try `npx lefthook install` first since it needs no global install)
Run: `npx lefthook install`
Expected: installs a `.git/hooks/pre-commit` that Lefthook manages.

- [ ] **Step 3: Verify it runs**

Make a trivial whitespace-only change to any already-committed backend `.ts` file, `git add` it, and run `git commit` for real (a real commit is fine here — it's exercising the hook, and the ledger's own commit-per-task discipline expects a commit at the end of this task anyway). Confirm the hook's lint/typecheck commands actually execute and print output before the commit completes. If it fails on a real (non-trivial) finding, fix that finding — don't bypass the hook with `--no-verify`.

- [ ] **Step 4: Commit `lefthook.yml` itself**

```bash
git add lefthook.yml
git commit -m "chore: add Lefthook pre-commit hook running lint + typecheck"
```

(If Step 3's trivial-change commit already included `lefthook.yml`, skip this — don't create an empty commit.)

---

## Backend

### Task 1: Backend project scaffold

**Files:**
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/vitest.config.ts`
- Create: `.gitignore` (repo root)

**Interfaces:**
- Produces: an `npm test` script in `backend/` that future tasks add specs to; a `backend/tsconfig.json` with `strict: true` that all backend code compiles under.

- [ ] **Step 1: Create `backend/package.json`**

```json
{
  "name": "sla-dashboard-backend",
  "version": "1.0.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "pg": "^8.11.5"
  },
  "devDependencies": {
    "@types/aws-lambda": "^8.10.145",
    "@types/node": "^20.14.9",
    "@types/pg": "^8.11.6",
    "esbuild": "^0.21.5",
    "typescript": "^5.5.3",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `backend/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create repo-root `.gitignore`**

```
node_modules/
dist/
.aws-sam/
backend/samconfig.toml
.env
.env.local
frontend/.vercel
frontend/dist
```

- [ ] **Step 5: Install dependencies and verify**

Run: `cd backend && npm install`
Expected: installs cleanly, creates `backend/package-lock.json`.

Run: `npm test`
Expected: Vitest reports "No test files found" (expected — no specs yet) without erroring.

- [ ] **Step 6: Commit**

```bash
git add .gitignore backend/package.json backend/package-lock.json backend/tsconfig.json backend/vitest.config.ts
git commit -m "chore: scaffold backend TypeScript project"
```

---

### Task 2: Shared types

**Files:**
- Create: `backend/src/shared/types.ts`

**Interfaces:**
- Produces: `DataQualityFlag`, `RawCheckRow`, `CleanedCheckRow`, `CleanResult` — imported by every later backend task.

- [ ] **Step 1: Write the types file**

```typescript
export type DataQualityFlag =
  | 'epoch_timestamp'
  | 'unit_converted'
  | 'missing_latency'
  | 'negative_latency_nulled';

export interface RawCheckRow {
  service_id: string;
  service_name: string;
  timestamp: string;
  status_code: string;
  latency: string;
  latency_unit: string;
  agent: string;
  region: string;
}

export interface CleanedCheckRow {
  service_id: string;
  service_name: string;
  ts: string; // ISO-8601 UTC
  status_code: number;
  latency_ms: number | null;
  agent: string;
  region: string;
  data_quality_flag: DataQualityFlag | null;
  raw_line: string;
}

export interface CleanResult {
  rows: CleanedCheckRow[];
  rows_received: number;
  rows_skipped: number;
  flags_summary: Record<DataQualityFlag, number>;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd backend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/shared/types.ts
git commit -m "feat: add shared backend types"
```

---

### Task 3: CSV parsing and field normalization

**Files:**
- Create: `backend/src/upload-handler/parse.ts`
- Test: `backend/src/upload-handler/parse.test.ts`

**Interfaces:**
- Consumes: `RawCheckRow` from `../shared/types`.
- Produces: `parseCsv(text: string): { raw: RawCheckRow; rawLine: string }[]` (throws `Error` on header mismatch), `normalizeTimestamp(raw: string): { iso: string | null; wasEpoch: boolean }`, `normalizeLatency(raw: string, unit: string): { ms: number | null; flag: 'unit_converted' | 'missing_latency' | 'negative_latency_nulled' | null }` — all consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { parseCsv, normalizeTimestamp, normalizeLatency } from './parse';

describe('parseCsv', () => {
  const header = 'service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region';

  it('parses rows and keeps the original line', () => {
    const line = 'svc-auth,auth-api,2025-05-13T12:45:00Z,200,181,ms,agent-1,ap-south-1';
    const result = parseCsv(`${header}\n${line}`);
    expect(result).toHaveLength(1);
    expect(result[0].raw.service_id).toBe('svc-auth');
    expect(result[0].raw.status_code).toBe('200');
    expect(result[0].rawLine).toBe(line);
  });

  it('throws on an unexpected header', () => {
    expect(() => parseCsv('wrong,header\nfoo,bar')).toThrow(/Unexpected CSV header/);
  });

  it('skips blank lines', () => {
    const line = 'svc-auth,auth-api,2025-05-13T12:45:00Z,200,181,ms,agent-1,ap-south-1';
    const result = parseCsv(`${header}\n${line}\n\n`);
    expect(result).toHaveLength(1);
  });
});

describe('normalizeTimestamp', () => {
  it('passes through a valid ISO-8601 timestamp', () => {
    const result = normalizeTimestamp('2025-05-13T12:45:00Z');
    expect(result.iso).toBe('2025-05-13T12:45:00.000Z');
    expect(result.wasEpoch).toBe(false);
  });

  it('converts a raw Unix epoch-seconds value', () => {
    const result = normalizeTimestamp('1746938700');
    expect(result.iso).toBe(new Date(1746938700 * 1000).toISOString());
    expect(result.wasEpoch).toBe(true);
  });

  it('returns null iso for garbage input', () => {
    const result = normalizeTimestamp('not-a-date');
    expect(result.iso).toBeNull();
  });
});

describe('normalizeLatency', () => {
  it('keeps a plain ms value unchanged', () => {
    expect(normalizeLatency('707', 'ms')).toEqual({ ms: 707, flag: null });
  });

  it('converts seconds to milliseconds and flags it', () => {
    expect(normalizeLatency('0.717', 's')).toEqual({ ms: 717, flag: 'unit_converted' });
  });

  it('flags a missing value as missing_latency', () => {
    expect(normalizeLatency('', 'ms')).toEqual({ ms: null, flag: 'missing_latency' });
  });

  it('nulls out a negative value and flags it', () => {
    expect(normalizeLatency('-296', 'ms')).toEqual({ ms: null, flag: 'negative_latency_nulled' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/upload-handler/parse.test.ts`
Expected: FAIL — `./parse` module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import type { RawCheckRow, DataQualityFlag } from '../shared/types';

const EXPECTED_HEADER = [
  'service_id', 'service_name', 'timestamp', 'status_code',
  'latency', 'latency_unit', 'agent', 'region',
];

export function parseCsv(text: string): { raw: RawCheckRow; rawLine: string }[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error('CSV is empty');
  }
  const header = lines[0].split(',').map((h) => h.trim());
  if (header.join(',') !== EXPECTED_HEADER.join(',')) {
    throw new Error(`Unexpected CSV header: ${lines[0]}`);
  }
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const raw: RawCheckRow = {
      service_id: cols[0] ?? '',
      service_name: cols[1] ?? '',
      timestamp: cols[2] ?? '',
      status_code: cols[3] ?? '',
      latency: cols[4] ?? '',
      latency_unit: cols[5] ?? '',
      agent: cols[6] ?? '',
      region: cols[7] ?? '',
    };
    return { raw, rawLine: line };
  });
}

export function normalizeTimestamp(raw: string): { iso: string | null; wasEpoch: boolean } {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const date = new Date(Number(trimmed) * 1000);
    return { iso: isNaN(date.getTime()) ? null : date.toISOString(), wasEpoch: true };
  }
  const date = new Date(trimmed);
  return { iso: isNaN(date.getTime()) ? null : date.toISOString(), wasEpoch: false };
}

export function normalizeLatency(
  raw: string,
  unit: string,
): { ms: number | null; flag: DataQualityFlag | null } {
  const trimmed = raw.trim();
  if (trimmed === '' || isNaN(Number(trimmed))) {
    return { ms: null, flag: 'missing_latency' };
  }
  const value = Number(trimmed);
  const isSeconds = unit.trim() === 's';
  const ms = isSeconds ? value * 1000 : value;
  if (ms < 0) {
    return { ms: null, flag: 'negative_latency_nulled' };
  }
  return { ms, flag: isSeconds ? 'unit_converted' : null };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/upload-handler/parse.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/upload-handler/parse.ts backend/src/upload-handler/parse.test.ts
git commit -m "feat: add CSV parsing and field normalization"
```

---

### Task 4: Row cleaning orchestration

**Files:**
- Create: `backend/src/upload-handler/clean.ts`
- Test: `backend/src/upload-handler/clean.test.ts`

**Interfaces:**
- Consumes: `parseCsv`, `normalizeTimestamp`, `normalizeLatency` from `./parse`; types from `../shared/types`.
- Produces: `cleanRow(raw: RawCheckRow, rawLine: string): CleanedCheckRow | null`, `cleanBatch(csvText: string): CleanResult` — `cleanBatch` is consumed directly by Task 6 (upload-handler Lambda).

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { cleanRow, cleanBatch } from './clean';
import type { RawCheckRow } from '../shared/types';

const base: RawCheckRow = {
  service_id: 'svc-auth',
  service_name: 'auth-api',
  timestamp: '2025-05-13T12:45:00Z',
  status_code: '200',
  latency: '181',
  latency_unit: 'ms',
  agent: 'agent-1',
  region: 'ap-south-1',
};

describe('cleanRow', () => {
  it('cleans a well-formed row with no flag', () => {
    const result = cleanRow(base, 'raw-line');
    expect(result).toMatchObject({
      service_id: 'svc-auth',
      status_code: 200,
      latency_ms: 181,
      data_quality_flag: null,
    });
  });

  it('returns null when a required field is missing', () => {
    const result = cleanRow({ ...base, service_id: '' }, 'raw-line');
    expect(result).toBeNull();
  });

  it('returns null when the timestamp is unparseable', () => {
    const result = cleanRow({ ...base, timestamp: 'garbage' }, 'raw-line');
    expect(result).toBeNull();
  });

  it('keeps status 999 as-is with no flag', () => {
    const result = cleanRow({ ...base, status_code: '999' }, 'raw-line');
    expect(result?.status_code).toBe(999);
    expect(result?.data_quality_flag).toBeNull();
  });

  it('prefers the latency flag over the epoch flag when both apply', () => {
    const result = cleanRow({ ...base, timestamp: '1746938700', latency: '-5' }, 'raw-line');
    expect(result?.data_quality_flag).toBe('negative_latency_nulled');
  });
});

describe('cleanBatch', () => {
  const header = 'service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region';

  it('counts received, skipped, and flag totals', () => {
    const goodLine = 'svc-auth,auth-api,2025-05-13T12:45:00Z,200,181,ms,agent-1,ap-south-1';
    const epochLine = 'svc-search,search-api,1746938700,200,0.717,s,agent-1,ap-south-1';
    const badLine = ',auth-api,2025-05-13T12:45:00Z,200,181,ms,agent-1,ap-south-1';
    const csv = `${header}\n${goodLine}\n${epochLine}\n${badLine}`;

    const result = cleanBatch(csv);

    expect(result.rows_received).toBe(3);
    expect(result.rows_skipped).toBe(1);
    expect(result.rows).toHaveLength(2);
    expect(result.flags_summary.unit_converted).toBe(1);
    expect(result.flags_summary.epoch_timestamp).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/upload-handler/clean.test.ts`
Expected: FAIL — `./clean` module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { parseCsv, normalizeTimestamp, normalizeLatency } from './parse';
import type { CleanedCheckRow, CleanResult, DataQualityFlag, RawCheckRow } from '../shared/types';

export function cleanRow(raw: RawCheckRow, rawLine: string): CleanedCheckRow | null {
  if (!raw.service_id || !raw.service_name || !raw.agent || !raw.region) {
    return null;
  }
  const { iso, wasEpoch } = normalizeTimestamp(raw.timestamp);
  if (iso === null) return null;

  const statusCode = Number(raw.status_code);
  if (isNaN(statusCode)) return null;

  const { ms, flag: latencyFlag } = normalizeLatency(raw.latency, raw.latency_unit);
  const flag: DataQualityFlag | null = latencyFlag ?? (wasEpoch ? 'epoch_timestamp' : null);

  return {
    service_id: raw.service_id,
    service_name: raw.service_name,
    ts: iso,
    status_code: statusCode,
    latency_ms: ms,
    agent: raw.agent,
    region: raw.region,
    data_quality_flag: flag,
    raw_line: rawLine,
  };
}

export function cleanBatch(csvText: string): CleanResult {
  const parsed = parseCsv(csvText);
  const rows: CleanedCheckRow[] = [];
  const flagsSummary: Record<DataQualityFlag, number> = {
    epoch_timestamp: 0,
    unit_converted: 0,
    missing_latency: 0,
    negative_latency_nulled: 0,
  };
  let skipped = 0;

  for (const { raw, rawLine } of parsed) {
    const row = cleanRow(raw, rawLine);
    if (row === null) {
      skipped++;
      continue;
    }
    if (row.data_quality_flag) flagsSummary[row.data_quality_flag]++;
    rows.push(row);
  }

  return { rows, rows_received: parsed.length, rows_skipped: skipped, flags_summary: flagsSummary };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/upload-handler/clean.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/upload-handler/clean.ts backend/src/upload-handler/clean.test.ts
git commit -m "feat: add row cleaning orchestration with data-quality flags"
```

---

### Task 5: Database schema and insert helper

**Files:**
- Create: `backend/schema.sql`
- Create: `backend/src/shared/db.ts`
- Test: `backend/src/shared/db.test.ts`

**Interfaces:**
- Consumes: `CleanedCheckRow` from `./types`.
- Produces: `getPool(): Pool`, `insertCleanedRows(rows: CleanedCheckRow[]): Promise<{ inserted: number; duplicates: number }>` — consumed by Task 6. `checks` table — consumed by Tasks 7 and 8's SQL.

- [ ] **Step 1: Write the schema file**

```sql
create table if not exists checks (
  id                bigserial primary key,
  service_id        text not null,
  service_name      text not null,
  ts                timestamptz not null,
  status_code       int not null,
  latency_ms        numeric,
  agent             text not null,
  region            text not null,
  data_quality_flag text,
  raw_line          text not null,
  unique (service_id, ts, agent)
);

create index if not exists checks_ts_idx on checks (ts);
create index if not exists checks_service_ts_idx on checks (service_id, ts);
```

- [ ] **Step 2: Write the failing test for the insert helper**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CleanedCheckRow } from './types';

const queryMock = vi.fn();
vi.mock('pg', () => ({
  Pool: vi.fn(() => ({ query: queryMock })),
}));

const row: CleanedCheckRow = {
  service_id: 'svc-auth',
  service_name: 'auth-api',
  ts: '2025-05-13T12:45:00.000Z',
  status_code: 200,
  latency_ms: 181,
  agent: 'agent-1',
  region: 'ap-south-1',
  data_quality_flag: null,
  raw_line: 'raw',
};

beforeEach(() => {
  queryMock.mockReset();
});

describe('insertCleanedRows', () => {
  it('returns zero counts for an empty batch without querying', async () => {
    const { insertCleanedRows } = await import('./db');
    const result = await insertCleanedRows([]);
    expect(result).toEqual({ inserted: 0, duplicates: 0 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('builds a parameterized multi-row insert and reports duplicates from the row-count gap', async () => {
    queryMock.mockResolvedValue({ rowCount: 1 });
    const { insertCleanedRows } = await import('./db');
    const result = await insertCleanedRows([row, row]);

    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('on conflict (service_id, ts, agent) do nothing');
    expect(values).toHaveLength(18);
    expect(result).toEqual({ inserted: 1, duplicates: 1 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/shared/db.test.ts`
Expected: FAIL — `./db` module not found.

- [ ] **Step 4: Write the implementation**

```typescript
import { Pool } from 'pg';
import type { CleanedCheckRow } from './types';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

export async function insertCleanedRows(
  rows: CleanedCheckRow[],
): Promise<{ inserted: number; duplicates: number }> {
  if (rows.length === 0) return { inserted: 0, duplicates: 0 };

  const values: unknown[] = [];
  const placeholders = rows
    .map((r, i) => {
      const base = i * 9;
      values.push(
        r.service_id, r.service_name, r.ts, r.status_code,
        r.latency_ms, r.agent, r.region, r.data_quality_flag, r.raw_line,
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`;
    })
    .join(',');

  const sql = `
    insert into checks (service_id, service_name, ts, status_code, latency_ms, agent, region, data_quality_flag, raw_line)
    values ${placeholders}
    on conflict (service_id, ts, agent) do nothing
    returning id
  `;

  const result = await getPool().query(sql, values);
  const inserted = result.rowCount ?? 0;
  return { inserted, duplicates: rows.length - inserted };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/shared/db.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/schema.sql backend/src/shared/db.ts backend/src/shared/db.test.ts
git commit -m "feat: add checks table schema and parameterized bulk-insert helper"
```

---

### Task 6: upload-handler Lambda entry point

**Files:**
- Create: `backend/src/upload-handler/index.ts`
- Test: `backend/src/upload-handler/index.test.ts`

**Interfaces:**
- Consumes: `cleanBatch` from `./clean`, `insertCleanedRows` from `../shared/db`.
- Produces: `handleUpload(csvText: string, insert?: typeof insertCleanedRows)`, `handler(event: APIGatewayProxyEventV2)` — `handler` is what `template.yaml` (Task 10) points to.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { handleUpload } from './index';

describe('handleUpload', () => {
  const header = 'service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region';
  const line = 'svc-auth,auth-api,2025-05-13T12:45:00Z,200,181,ms,agent-1,ap-south-1';

  it('returns 400 for an empty body', async () => {
    const result = await handleUpload('');
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when the CSV header is wrong', async () => {
    const result = await handleUpload('wrong,header\nfoo,bar');
    expect(result.statusCode).toBe(400);
  });

  it('cleans, inserts, and summarizes a valid upload', async () => {
    const fakeInsert = vi.fn().mockResolvedValue({ inserted: 1, duplicates: 0 });
    const result = await handleUpload(`${header}\n${line}`, fakeInsert);

    expect(result.statusCode).toBe(200);
    expect(fakeInsert).toHaveBeenCalledTimes(1);
    expect(result.body).toMatchObject({
      rows_received: 1,
      rows_inserted: 1,
      rows_duplicate: 0,
      rows_skipped: 0,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/upload-handler/index.test.ts`
Expected: FAIL — `./index` module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { cleanBatch } from './clean';
import { insertCleanedRows } from '../shared/db';

export async function handleUpload(
  csvText: string,
  insert: typeof insertCleanedRows = insertCleanedRows,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  if (!csvText || csvText.trim().length === 0) {
    return { statusCode: 400, body: { error: 'Empty upload body' } };
  }

  let result;
  try {
    result = cleanBatch(csvText);
  } catch (err) {
    return { statusCode: 400, body: { error: (err as Error).message } };
  }

  const { inserted, duplicates } = await insert(result.rows);

  return {
    statusCode: 200,
    body: {
      rows_received: result.rows_received,
      rows_inserted: inserted,
      rows_duplicate: duplicates,
      rows_skipped: result.rows_skipped,
      flags_summary: result.flags_summary,
    },
  };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const csvText = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body ?? '';

  const result = await handleUpload(csvText);

  return {
    statusCode: result.statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/upload-handler/index.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/upload-handler/index.ts backend/src/upload-handler/index.test.ts
git commit -m "feat: add upload-handler Lambda entry point"
```

---

### Task 7: query-handler stats logic

**Files:**
- Create: `backend/src/query-handler/stats.ts`
- Test: `backend/src/query-handler/stats.test.ts`

**Interfaces:**
- Consumes: `getPool` from `../shared/db`.
- Produces: `ServiceStats` type, `getServiceStats(from?: string, to?: string): Promise<{ overall: OverallStats; by_service: ServiceStats[] }>` — consumed by Task 9 (query-handler router).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../shared/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

beforeEach(() => {
  queryMock.mockReset();
});

describe('getServiceStats', () => {
  it('merges the aggregate query and the incident-count query per service, and applies the 99.9% threshold', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          service_id: 'svc-auth', service_name: 'auth-api',
          total_checks: '999', up_checks: '990', down_checks: '9', check_failures: '1',
          avg_latency_ms: '150.5', p95_latency_ms: '300',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ service_id: 'svc-auth', incident_count: '2' }],
      });

    const { getServiceStats } = await import('./stats');
    const result = await getServiceStats('2025-05-01', '2025-05-02');

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(result.by_service).toHaveLength(1);
    expect(result.by_service[0]).toMatchObject({
      service_id: 'svc-auth',
      incident_count: 2,
      check_failures: 1,
      downtime_minutes: 135, // 9 down checks * 15 minutes
      breaches_slo: true, // 990/999 = 99.0% < 99.9%
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npx vitest run src/query-handler/stats.test.ts`
Expected: FAIL — `./stats` module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import { getPool } from '../shared/db';
import { toRangeBounds } from '../shared/dateRange';

export interface ServiceStats {
  service_id: string;
  service_name: string;
  uptime_pct: number;
  breaches_slo: boolean;
  incident_count: number;
  downtime_minutes: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  check_failures: number;
}

export interface OverallStats {
  total_services: number;
  services_breaching_slo: number;
}

const SLO_THRESHOLD_PCT = 99.9;
const CHECK_INTERVAL_MINUTES = 15;

export async function getServiceStats(
  from?: string,
  to?: string,
): Promise<{ overall: OverallStats; by_service: ServiceStats[] }> {
  const { start, end } = toRangeBounds(from, to);
  const pool = getPool();

  const aggregate = await pool.query(
    `select
       service_id, service_name,
       count(*) filter (where status_code != 999) as total_checks,
       count(*) filter (where status_code < 400 and status_code != 999) as up_checks,
       count(*) filter (where status_code >= 400 and status_code != 999) as down_checks,
       count(*) filter (where status_code = 999) as check_failures,
       avg(latency_ms) as avg_latency_ms,
       percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms
     from checks
     where ts >= $1 and ts < $2
     group by service_id, service_name`,
    [start, end],
  );

  const incidents = await pool.query(
    `with flagged as (
       select service_id, ts,
         (status_code >= 400 and status_code != 999) as is_down,
         lag(status_code >= 400 and status_code != 999) over (partition by service_id order by ts) as prev_down
       from checks
       where ts >= $1 and ts < $2
     )
     select service_id, count(*) as incident_count
     from flagged
     where is_down and (prev_down is distinct from true)
     group by service_id`,
    [start, end],
  );

  const incidentCounts = new Map<string, number>(
    incidents.rows.map((r: { service_id: string; incident_count: string }) => [
      r.service_id,
      Number(r.incident_count),
    ]),
  );

  const byService: ServiceStats[] = aggregate.rows.map((r: {
    service_id: string; service_name: string; total_checks: string;
    up_checks: string; down_checks: string; check_failures: string;
    avg_latency_ms: string | null; p95_latency_ms: string | null;
  }) => {
    const totalChecks = Number(r.total_checks);
    const upChecks = Number(r.up_checks);
    const downChecks = Number(r.down_checks);
    const uptimePct = totalChecks === 0 ? 100 : Math.round((upChecks / totalChecks) * 100000) / 1000;

    return {
      service_id: r.service_id,
      service_name: r.service_name,
      uptime_pct: uptimePct,
      breaches_slo: uptimePct < SLO_THRESHOLD_PCT,
      incident_count: incidentCounts.get(r.service_id) ?? 0,
      downtime_minutes: downChecks * CHECK_INTERVAL_MINUTES,
      avg_latency_ms: r.avg_latency_ms === null ? null : Math.round(Number(r.avg_latency_ms)),
      p95_latency_ms: r.p95_latency_ms === null ? null : Math.round(Number(r.p95_latency_ms)),
      check_failures: Number(r.check_failures),
    };
  });

  return {
    overall: {
      total_services: byService.length,
      services_breaching_slo: byService.filter((s) => s.breaches_slo).length,
    },
    by_service: byService,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npx vitest run src/query-handler/stats.test.ts`
Expected: PASS. (This task depends on `toRangeBounds` from Task 8 — if run before Task 8 exists, create a temporary stub `backend/src/shared/dateRange.ts` exporting `toRangeBounds` returning `{ start: '1970-01-01T00:00:00.000Z', end: new Date(Date.now() + 86400000).toISOString() }` regardless of input, then let Task 8 replace it with the real implementation.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/query-handler/stats.ts backend/src/query-handler/stats.test.ts
git commit -m "feat: add per-service SLA stats aggregation"
```

---

### Task 8: query-handler logs logic and date-range helper

**Files:**
- Create: `backend/src/shared/dateRange.ts`
- Create: `backend/src/query-handler/logs.ts`
- Test: `backend/src/shared/dateRange.test.ts`
- Test: `backend/src/query-handler/logs.test.ts`

**Interfaces:**
- Produces: `toRangeBounds(from?: string, to?: string): { start: string; end: string }` (also consumed by Task 7); `LogRow` type, `getLogs(params: { from?: string; to?: string; service?: string; page: number; pageSize: number }): Promise<{ rows: LogRow[]; total: number; page: number; page_size: number }>` — consumed by Task 9.

- [ ] **Step 1: Write the failing test for `toRangeBounds`**

```typescript
import { describe, it, expect } from 'vitest';
import { toRangeBounds } from './dateRange';

describe('toRangeBounds', () => {
  it('expands a single date to a full UTC day', () => {
    const { start, end } = toRangeBounds('2025-05-13', '2025-05-13');
    expect(start).toBe('2025-05-13T00:00:00.000Z');
    expect(end).toBe('2025-05-14T00:00:00.000Z');
  });

  it('spans from the start of "from" to the end of "to"', () => {
    const { start, end } = toRangeBounds('2025-05-01', '2025-05-03');
    expect(start).toBe('2025-05-01T00:00:00.000Z');
    expect(end).toBe('2025-05-04T00:00:00.000Z');
  });

  it('defaults to an open range when both are omitted', () => {
    const { start, end } = toRangeBounds();
    expect(start).toBe('1970-01-01T00:00:00.000Z');
    expect(new Date(end).getTime()).toBeGreaterThan(Date.now());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/shared/dateRange.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `dateRange.ts`**

```typescript
const DAY_MS = 24 * 60 * 60 * 1000;

export function toRangeBounds(from?: string, to?: string): { start: string; end: string } {
  const start = from ? new Date(`${from}T00:00:00Z`).toISOString() : new Date(0).toISOString();
  const endDate = to ?? from;
  const end = endDate
    ? new Date(new Date(`${endDate}T00:00:00Z`).getTime() + DAY_MS).toISOString()
    : new Date(Date.now() + DAY_MS).toISOString();
  return { start, end };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/shared/dateRange.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for `getLogs`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../shared/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

beforeEach(() => {
  queryMock.mockReset();
});

describe('getLogs', () => {
  it('filters by service and paginates, returning total from a separate count query', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: 1, service_id: 'svc-auth' }] })
      .mockResolvedValueOnce({ rows: [{ count: '42' }] });

    const { getLogs } = await import('./logs');
    const result = await getLogs({ service: 'svc-auth', page: 2, pageSize: 10 });

    expect(queryMock).toHaveBeenCalledTimes(2);
    const [dataSql, dataValues] = queryMock.mock.calls[0];
    expect(dataSql).toContain('service_id = $');
    expect(dataSql).toContain('limit');
    expect(dataValues).toContain('svc-auth');
    expect(result).toEqual({ rows: [{ id: 1, service_id: 'svc-auth' }], total: 42, page: 2, page_size: 10 });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend && npx vitest run src/query-handler/logs.test.ts`
Expected: FAIL — `./logs` module not found.

- [ ] **Step 7: Implement `logs.ts`**

```typescript
import { getPool } from '../shared/db';
import { toRangeBounds } from '../shared/dateRange';

export interface LogRow {
  id: number;
  service_id: string;
  service_name: string;
  ts: string;
  status_code: number;
  latency_ms: number | null;
  agent: string;
  region: string;
  data_quality_flag: string | null;
}

export async function getLogs(params: {
  from?: string;
  to?: string;
  service?: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: LogRow[]; total: number; page: number; page_size: number }> {
  const { start, end } = toRangeBounds(params.from, params.to);
  const conditions = ['ts >= $1', 'ts < $2'];
  const values: unknown[] = [start, end];

  if (params.service) {
    values.push(params.service);
    conditions.push(`service_id = $${values.length}`);
  }

  const where = `where ${conditions.join(' and ')}`;
  const offset = (params.page - 1) * params.pageSize;

  const dataValues = [...values, params.pageSize, offset];
  const dataSql = `
    select id, service_id, service_name, ts, status_code, latency_ms, agent, region, data_quality_flag
    from checks
    ${where}
    order by ts desc
    limit $${dataValues.length - 1} offset $${dataValues.length}
  `;

  const pool = getPool();
  const dataResult = await pool.query(dataSql, dataValues);
  const countResult = await pool.query(`select count(*) from checks ${where}`, values);

  return {
    rows: dataResult.rows,
    total: Number(countResult.rows[0].count),
    page: params.page,
    page_size: params.pageSize,
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd backend && npx vitest run src/query-handler/logs.test.ts`
Expected: PASS.

- [ ] **Step 9: Re-run the full suite to confirm Task 7 still passes with the real `dateRange.ts`**

Run: `cd backend && npm test`
Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add backend/src/shared/dateRange.ts backend/src/shared/dateRange.test.ts backend/src/query-handler/logs.ts backend/src/query-handler/logs.test.ts
git commit -m "feat: add date-range helper and paginated logs query"
```

---

### Task 9: query-handler Lambda router

**Files:**
- Create: `backend/src/query-handler/index.ts`
- Test: `backend/src/query-handler/index.test.ts`

**Interfaces:**
- Consumes: `getServiceStats` from `./stats`, `getLogs` from `./logs`.
- Produces: `handler(event: APIGatewayProxyEventV2)` — what `template.yaml` (Task 10) points to for `/stats` and `/logs`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('./stats', () => ({ getServiceStats: vi.fn().mockResolvedValue({ overall: {}, by_service: [] }) }));
vi.mock('./logs', () => ({ getLogs: vi.fn().mockResolvedValue({ rows: [], total: 0, page: 1, page_size: 50 }) }));

import { handler } from './index';
import { getServiceStats } from './stats';
import { getLogs } from './logs';

function makeEvent(path: string, qs: Record<string, string>) {
  return { rawPath: path, queryStringParameters: qs } as any;
}

describe('query-handler router', () => {
  it('routes /stats to getServiceStats with from/to', async () => {
    const result = await handler(makeEvent('/stats', { from: '2025-05-01', to: '2025-05-02' }));
    expect(getServiceStats).toHaveBeenCalledWith('2025-05-01', '2025-05-02');
    expect(result.statusCode).toBe(200);
  });

  it('routes /logs to getLogs with parsed pagination', async () => {
    const result = await handler(makeEvent('/logs', { service: 'svc-auth', page: '2', page_size: '25' }));
    expect(getLogs).toHaveBeenCalledWith({ from: undefined, to: undefined, service: 'svc-auth', page: 2, pageSize: 25 });
    expect(result.statusCode).toBe(200);
  });

  it('returns 404 for an unknown route', async () => {
    const result = await handler(makeEvent('/nope', {}));
    expect(result.statusCode).toBe(404);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run src/query-handler/index.test.ts`
Expected: FAIL — `./index` module not found.

- [ ] **Step 3: Write the implementation**

```typescript
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { getServiceStats } from './stats';
import { getLogs } from './logs';

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const path = event.rawPath;
  const qs = event.queryStringParameters ?? {};

  try {
    if (path === '/stats') {
      const data = await getServiceStats(qs.from, qs.to);
      return json(200, data);
    }
    if (path === '/logs') {
      const data = await getLogs({
        from: qs.from,
        to: qs.to,
        service: qs.service,
        page: Number(qs.page ?? '1'),
        pageSize: Number(qs.page_size ?? '50'),
      });
      return json(200, data);
    }
    return json(404, { error: `Unknown route: ${path}` });
  } catch (err) {
    return json(400, { error: (err as Error).message });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run src/query-handler/index.test.ts`
Expected: all PASS.

- [ ] **Step 5: Run the full backend suite**

Run: `cd backend && npm test`
Expected: every test file passes.

- [ ] **Step 6: Commit**

```bash
git add backend/src/query-handler/index.ts backend/src/query-handler/index.test.ts
git commit -m "feat: add query-handler Lambda router for /stats and /logs"
```

---

### Task 10: SAM template

**Files:**
- Create: `backend/template.yaml`

**Interfaces:**
- Consumes: `backend/src/upload-handler/index.handler`, `backend/src/query-handler/index.handler`.
- Produces: deployed API Gateway routes `POST /upload`, `GET /stats`, `GET /logs` — consumed by Task 13 (deploy) and every frontend task's `VITE_API_BASE_URL`.

- [ ] **Step 1: Write `backend/template.yaml`**

```yaml
AWSTemplateFormatVersion: '2010-09-09'
Transform: AWS::Serverless-2016-10-31
Description: SLA Monitoring Dashboard backend

Parameters:
  DatabaseUrl:
    Type: String
    NoEcho: true

Globals:
  Function:
    Runtime: nodejs20.x
    Timeout: 30
    MemorySize: 256
    Environment:
      Variables:
        DATABASE_URL: !Ref DatabaseUrl

Resources:
  Api:
    Type: AWS::Serverless::HttpApi

  UploadHandler:
    Type: AWS::Serverless::Function
    Metadata:
      BuildMethod: esbuild
      BuildProperties:
        EntryPoints:
          - src/upload-handler/index.ts
        Minify: false
        Target: node20
    Properties:
      Handler: src/upload-handler/index.handler
      Events:
        Upload:
          Type: HttpApi
          Properties:
            ApiId: !Ref Api
            Path: /upload
            Method: post

  QueryHandler:
    Type: AWS::Serverless::Function
    Metadata:
      BuildMethod: esbuild
      BuildProperties:
        EntryPoints:
          - src/query-handler/index.ts
        Minify: false
        Target: node20
    Properties:
      Handler: src/query-handler/index.handler
      Events:
        Stats:
          Type: HttpApi
          Properties:
            ApiId: !Ref Api
            Path: /stats
            Method: get
        Logs:
          Type: HttpApi
          Properties:
            ApiId: !Ref Api
            Path: /logs
            Method: get

Outputs:
  ApiUrl:
    Description: Base URL for the HTTP API
    Value: !Sub "https://${Api}.execute-api.${AWS::Region}.amazonaws.com"
```

- [ ] **Step 2: Commit**

```bash
git add backend/template.yaml
git commit -m "feat: add SAM template for upload-handler and query-handler"
```

*(Validation of this file requires the SAM CLI installed in Task 12 — it's checked there with `sam validate`, not here.)*

---

### Task 11 (MANUAL — requires your own Supabase account): Provision the database

This step needs your own account credentials and a browser — it cannot be scripted by an agent. Do this yourself (or paste commands via `!` in this session if you'd like the assistant to watch the output):

- [ ] **Step 1:** Go to supabase.com, sign up free, create a new project (any name/region).
- [ ] **Step 2:** In the Supabase dashboard, open the SQL Editor, paste the contents of `backend/schema.sql`, and run it.
- [ ] **Step 3:** In Project Settings → Database, copy the connection string (URI format, "Session pooler" or "Direct connection" — either works for Lambda). It looks like `postgresql://postgres:<password>@<host>:5432/postgres`.
- [ ] **Step 4:** Save that connection string somewhere private (e.g., a local `.env` file at repo root, already gitignored) — Task 13 needs it.

---

### Task 12 (MANUAL — requires your own AWS account): Install and configure AWS tooling

- [ ] **Step 1:** If you don't have an AWS account, create one at aws.amazon.com (free tier).
- [ ] **Step 2:** Install the AWS CLI (`https://aws.amazon.com/cli/` — Windows MSI installer is simplest).
- [ ] **Step 3:** Create an IAM user (or use root only for this initial setup) with programmatic access and reasonable permissions (AdministratorAccess is simplest for a throwaway take-home project; tighten later if you keep using this account).
- [ ] **Step 4:** Run `aws configure` in your own terminal and enter the access key, secret key, and a region (e.g. `ap-south-1` to match the monitoring data's region).
- [ ] **Step 5:** Install the AWS SAM CLI: `pip install aws-sam-cli` (requires Python) or the standalone installer at `https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html`.
- [ ] **Step 6:** Verify: run `sam --version` and `aws sts get-caller-identity` — both should succeed and show your account.

---

### Task 13 (MANUAL — first deploy is interactive): Deploy the backend

- [ ] **Step 1:** From `backend/`, run:

```bash
sam build
```

Expected: builds both functions with esbuild, no errors.

- [ ] **Step 2:** Run the guided deploy (interactive — answer its prompts yourself):

```bash
sam deploy --guided
```

When prompted for `DatabaseUrl`, paste the Supabase connection string from Task 11. Accept defaults for stack name (e.g. `sla-dashboard`), region (match what you configured), and confirm changeset. This creates `backend/samconfig.toml` (already gitignored) so future deploys are just `sam deploy`.

- [ ] **Step 3:** Note the `ApiUrl` output printed at the end of the deploy (e.g. `https://abc123.execute-api.ap-south-1.amazonaws.com`). Save it — the frontend tasks need it as `VITE_API_BASE_URL`.

- [ ] **Step 4:** Smoke-test the deployed endpoint from your own terminal:

```bash
curl -X POST "<ApiUrl>/upload" -H "Content-Type: text/csv" --data-binary @../monitoring_checks_9d_seed101.csv
```

Expected: a JSON response with `rows_received`, `rows_inserted`, etc. — confirms the real deployed Lambda works end-to-end against the real database.

---

## Frontend

### Task 14: Frontend scaffold

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx`
- Create: `frontend/.env.example`

**Interfaces:**
- Produces: a runnable Vite React app (`npm run dev`), `import.meta.env.VITE_API_BASE_URL` — consumed by Task 15's `api.ts`.

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "sla-dashboard-frontend",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^24.1.0",
    "typescript": "^5.5.3",
    "vite": "^5.3.4",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
```

- [ ] **Step 4: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>SLA Monitoring Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `frontend/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './App.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: Create `frontend/.env.example`**

```
VITE_API_BASE_URL=https://replace-with-your-api-gateway-url.execute-api.ap-south-1.amazonaws.com
```

- [ ] **Step 7: Create a placeholder `App.tsx` so the scaffold runs (Task 19 replaces this)**

```tsx
export default function App() {
  return <div>Loading...</div>;
}
```

- [ ] **Step 8: Create empty `frontend/src/App.css`**

(Empty file for now — Task 19 adds styling.)

- [ ] **Step 9: Install and verify**

Run: `cd frontend && npm install && npm run typecheck`
Expected: no errors.

Run: `npm run dev` (then stop it — this is just to confirm it boots)
Expected: Vite prints a local dev server URL with no errors.

- [ ] **Step 10: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vite.config.ts frontend/index.html frontend/src/main.tsx frontend/src/App.tsx frontend/src/App.css frontend/.env.example
git commit -m "chore: scaffold Vite React TypeScript frontend"
```

---

### Task 15: Typed API client

**Files:**
- Create: `frontend/src/api.ts`
- Test: `frontend/src/api.test.ts`

**Interfaces:**
- Produces: `UploadResponse`, `ServiceStats`, `StatsResponse`, `LogRow`, `LogsResponse` types; `uploadCsv(file: File): Promise<UploadResponse>`, `fetchStats(from?: string, to?: string): Promise<StatsResponse>`, `fetchLogs(opts: { from?: string; to?: string; service?: string; page: number; pageSize: number }): Promise<LogsResponse>` — consumed by Tasks 16-19.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { uploadCsv, fetchStats, fetchLogs } from './api';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

describe('api client', () => {
  it('uploadCsv posts the file text as text/csv and returns the parsed JSON', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ rows_received: 1 }) });
    const file = new File(['a,b\n1,2'], 'test.csv', { type: 'text/csv' });

    const result = await uploadCsv(file);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/upload'),
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'text/csv' } }),
    );
    expect(result).toEqual({ rows_received: 1 });
  });

  it('fetchStats builds query params only for provided dates', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: async () => ({ overall: {}, by_service: [] }) });
    await fetchStats('2025-05-01', '2025-05-02');
    const calledUrl = (fetch as any).mock.calls[0][0] as string;
    expect(calledUrl).toContain('from=2025-05-01');
    expect(calledUrl).toContain('to=2025-05-02');
  });

  it('fetchLogs throws on a non-ok response', async () => {
    (fetch as any).mockResolvedValue({ ok: false, json: async () => ({ error: 'bad request' }) });
    await expect(fetchLogs({ page: 1, pageSize: 10 })).rejects.toThrow('bad request');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/api.test.ts`
Expected: FAIL — `./api` module not found.

- [ ] **Step 3: Write the implementation**

```typescript
const BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

export interface UploadResponse {
  rows_received: number;
  rows_inserted: number;
  rows_duplicate: number;
  rows_skipped: number;
  flags_summary: Record<string, number>;
}

export interface ServiceStats {
  service_id: string;
  service_name: string;
  uptime_pct: number;
  breaches_slo: boolean;
  incident_count: number;
  downtime_minutes: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  check_failures: number;
}

export interface StatsResponse {
  overall: { total_services: number; services_breaching_slo: number };
  by_service: ServiceStats[];
}

export interface LogRow {
  id: number;
  service_id: string;
  service_name: string;
  ts: string;
  status_code: number;
  latency_ms: number | null;
  agent: string;
  region: string;
  data_quality_flag: string | null;
}

export interface LogsResponse {
  rows: LogRow[];
  total: number;
  page: number;
  page_size: number;
}

async function parseErrorOrThrow(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new Error(body.error ?? `Request failed with status ${res.status}`);
}

export async function uploadCsv(file: File): Promise<UploadResponse> {
  const text = await file.text();
  const res = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: text,
  });
  if (!res.ok) return parseErrorOrThrow(res);
  return res.json();
}

export async function fetchStats(from?: string, to?: string): Promise<StatsResponse> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const res = await fetch(`${BASE_URL}/stats?${params.toString()}`);
  if (!res.ok) return parseErrorOrThrow(res);
  return res.json();
}

export async function fetchLogs(opts: {
  from?: string;
  to?: string;
  service?: string;
  page: number;
  pageSize: number;
}): Promise<LogsResponse> {
  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.service) params.set('service', opts.service);
  params.set('page', String(opts.page));
  params.set('page_size', String(opts.pageSize));
  const res = await fetch(`${BASE_URL}/logs?${params.toString()}`);
  if (!res.ok) return parseErrorOrThrow(res);
  return res.json();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/api.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.ts frontend/src/api.test.ts
git commit -m "feat: add typed API client for upload/stats/logs"
```

---

### Task 16: UploadPanel component

**Files:**
- Create: `frontend/src/components/UploadPanel.tsx`

**Interfaces:**
- Consumes: `uploadCsv`, `UploadResponse` from `../api`.
- Produces: `<UploadPanel onUploaded={(summary: UploadResponse) => void} />` — consumed by Task 19 (`App.tsx`).

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { uploadCsv, type UploadResponse } from '../api';

export default function UploadPanel({ onUploaded }: { onUploaded: (summary: UploadResponse) => void }) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus('uploading');
    setError(null);
    try {
      const summary = await uploadCsv(file);
      setStatus('idle');
      onUploaded(summary);
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  }

  return (
    <section className="upload-panel">
      <label htmlFor="csv-upload">Upload health-check CSV</label>
      <input
        id="csv-upload"
        type="file"
        accept=".csv,text/csv"
        disabled={status === 'uploading'}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {status === 'uploading' && <p>Uploading and processing...</p>}
      {status === 'error' && <p role="alert">Upload failed: {error}</p>}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors (App.tsx still the placeholder — this component isn't wired in until Task 19, so an unused-file check is not applicable here).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/UploadPanel.tsx
git commit -m "feat: add UploadPanel component"
```

---

### Task 17: StatsPanel component

**Files:**
- Create: `frontend/src/components/StatsPanel.tsx`

**Interfaces:**
- Consumes: `StatsResponse` from `../api`.
- Produces: `<StatsPanel stats={StatsResponse | null} loading={boolean} />` — consumed by Task 19.

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import type { StatsResponse } from '../api';

export default function StatsPanel({ stats, loading }: { stats: StatsResponse | null; loading: boolean }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="stats-panel">
      <button onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        {expanded ? 'Hide' : 'Show'} stats
      </button>
      {expanded && (
        <div>
          {loading && <p>Loading stats...</p>}
          {!loading && stats && stats.by_service.length === 0 && <p>No data for this range.</p>}
          {!loading && stats && (
            <div className="stats-grid">
              {stats.by_service.map((s) => (
                <div key={s.service_id} className={s.breaches_slo ? 'stats-card breach' : 'stats-card'}>
                  <h3>{s.service_name}</h3>
                  <p>Uptime: {s.uptime_pct}%{s.breaches_slo ? ' — SLA BREACH' : ''}</p>
                  <p>Incidents: {s.incident_count} ({s.downtime_minutes} min downtime)</p>
                  <p>Avg latency: {s.avg_latency_ms ?? '—'} ms (p95: {s.p95_latency_ms ?? '—'} ms)</p>
                  <p>Check failures: {s.check_failures}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/StatsPanel.tsx
git commit -m "feat: add collapsible StatsPanel component"
```

---

### Task 18: LogsTable component

**Files:**
- Create: `frontend/src/components/LogsTable.tsx`

**Interfaces:**
- Consumes: `LogsResponse` from `../api`.
- Produces: `<LogsTable logs={LogsResponse | null} loading={boolean} from={string} to={string} service={string} onFromChange onToChange onServiceChange onPageChange />` — consumed by Task 19.

- [ ] **Step 1: Write the component**

```tsx
import type { LogsResponse } from '../api';

export default function LogsTable({
  logs, loading, from, to, service,
  onFromChange, onToChange, onServiceChange, onPageChange,
}: {
  logs: LogsResponse | null;
  loading: boolean;
  from: string;
  to: string;
  service: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onServiceChange: (v: string) => void;
  onPageChange: (page: number) => void;
}) {
  const totalPages = logs ? Math.max(1, Math.ceil(logs.total / logs.page_size)) : 1;

  return (
    <section className="logs-table">
      <div className="logs-filters">
        <label>
          From <input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} />
        </label>
        <label>
          To <input type="date" value={to} onChange={(e) => onToChange(e.target.value)} />
        </label>
        <label>
          Service
          <select value={service} onChange={(e) => onServiceChange(e.target.value)}>
            <option value="">All</option>
            <option value="svc-auth">svc-auth</option>
            <option value="svc-payments">svc-payments</option>
            <option value="svc-search">svc-search</option>
            <option value="svc-notify">svc-notify</option>
            <option value="svc-reports">svc-reports</option>
          </select>
        </label>
      </div>

      {loading && <p>Loading logs...</p>}
      {!loading && logs && (
        <>
          <table>
            <thead>
              <tr>
                <th>Timestamp</th><th>Service</th><th>Status</th><th>Latency (ms)</th>
                <th>Agent</th><th>Region</th><th>Quality flag</th>
              </tr>
            </thead>
            <tbody>
              {logs.rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.ts}</td>
                  <td>{r.service_name}</td>
                  <td>{r.status_code}</td>
                  <td>{r.latency_ms ?? '—'}</td>
                  <td>{r.agent}</td>
                  <td>{r.region}</td>
                  <td>{r.data_quality_flag ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pagination">
            <button disabled={logs.page <= 1} onClick={() => onPageChange(logs.page - 1)}>Previous</button>
            <span>Page {logs.page} of {totalPages}</span>
            <button disabled={logs.page >= totalPages} onClick={() => onPageChange(logs.page + 1)}>Next</button>
          </div>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/LogsTable.tsx
git commit -m "feat: add filterable, paginated LogsTable component"
```

---

### Task 19: Wire App.tsx

**Files:**
- Modify: `frontend/src/App.tsx` (replace placeholder from Task 14)
- Modify: `frontend/src/App.css` (replace empty file from Task 14)

**Interfaces:**
- Consumes: `fetchStats`, `fetchLogs` from `./api`; `UploadPanel`, `StatsPanel`, `LogsTable` from `./components/*`.
- Produces: the complete single-screen dashboard — this is the last frontend code task before deployment.

- [ ] **Step 1: Replace `App.tsx`**

```tsx
import { useEffect, useState, useCallback } from 'react';
import UploadPanel from './components/UploadPanel';
import StatsPanel from './components/StatsPanel';
import LogsTable from './components/LogsTable';
import { fetchStats, fetchLogs, type StatsResponse, type LogsResponse } from './api';

const PAGE_SIZE = 25;

export default function App() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [service, setService] = useState('');
  const [page, setPage] = useState(1);

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await fetchStats(from || undefined, to || undefined));
    } finally {
      setStatsLoading(false);
    }
  }, [from, to]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      setLogs(await fetchLogs({ from: from || undefined, to: to || undefined, service: service || undefined, page, pageSize: PAGE_SIZE }));
    } finally {
      setLogsLoading(false);
    }
  }, [from, to, service, page]);

  useEffect(() => { void loadStats(); }, [loadStats]);
  useEffect(() => { void loadLogs(); }, [loadLogs]);

  return (
    <main className="app">
      <h1>SLA Monitoring Dashboard</h1>
      <UploadPanel
        onUploaded={(summary) => {
          setBanner(
            `Inserted ${summary.rows_inserted}, duplicates ${summary.rows_duplicate}, skipped ${summary.rows_skipped}.`,
          );
          void loadStats();
          void loadLogs();
        }}
      />
      {banner && <p className="banner">{banner}</p>}
      <StatsPanel stats={stats} loading={statsLoading} />
      <LogsTable
        logs={logs}
        loading={logsLoading}
        from={from}
        to={to}
        service={service}
        onFromChange={(v) => { setFrom(v); setPage(1); }}
        onToChange={(v) => { setTo(v); setPage(1); }}
        onServiceChange={(v) => { setService(v); setPage(1); }}
        onPageChange={setPage}
      />
    </main>
  );
}
```

- [ ] **Step 2: Replace `App.css`**

```css
body { font-family: system-ui, sans-serif; margin: 0; background: #f7f7f8; color: #1a1a1a; }
.app { max-width: 1000px; margin: 0 auto; padding: 24px; }
.upload-panel { margin-bottom: 16px; padding: 16px; background: white; border-radius: 8px; }
.banner { padding: 8px 12px; background: #e6f4ea; border-radius: 6px; }
.stats-panel { margin-bottom: 24px; }
.stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 12px; }
.stats-card { padding: 12px; background: white; border-radius: 8px; border: 1px solid #ddd; }
.stats-card.breach { border-color: #d33; background: #fdecea; }
.logs-table table { width: 100%; border-collapse: collapse; background: white; }
.logs-table th, .logs-table td { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; font-size: 14px; }
.logs-filters { display: flex; gap: 16px; margin-bottom: 12px; }
.pagination { display: flex; gap: 12px; align-items: center; margin-top: 8px; }
```

- [ ] **Step 3: Verify locally**

Run: `cd frontend && echo "VITE_API_BASE_URL=<your deployed API Gateway URL from Task 13>" > .env.local && npm run dev`

Open the printed local URL in a browser. Upload `monitoring_checks_9d_seed101.csv` (from the repo root) via the upload panel, confirm the stats cards and logs table populate. Stop the dev server (Ctrl+C) when done.

- [ ] **Step 4: Run typecheck and build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: no errors; `frontend/dist/` is produced.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.css
git commit -m "feat: wire upload, stats, and logs into the single-screen dashboard"
```

---

## Amendment (2026-09-17, third): bugs found via Playwright + UI polish, at the author's request

### Task D: fix stray build output and empty error messages

Two real bugs surfaced while verifying Task 19 with Playwright against the local dev server.

**Files:**
- Create: `backend/src/shared/errors.ts`
- Test: `backend/src/shared/errors.test.ts`
- Modify: `backend/src/worker/index.ts` (use the new helper in its catch block)
- Modify: `frontend/package.json` (`build` script)

**Interfaces:**
- Produces: `getErrorMessage(err: unknown): string` — consumed by `worker/index.ts`'s catch block only, for now.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { getErrorMessage } from './errors';

describe('getErrorMessage', () => {
  it('returns a normal Error message', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('falls back to the first sub-error message when the top-level message is empty (AggregateError)', () => {
    const err = new AggregateError([new Error('connection refused')], '');
    expect(getErrorMessage(err)).toBe('connection refused');
  });

  it('returns a generic fallback for a non-Error value with nothing useful', () => {
    expect(getErrorMessage('just a string')).toBe('An unexpected error occurred');
  });

  it('returns a generic fallback for an empty AggregateError with no sub-errors', () => {
    const err = new AggregateError([], '');
    expect(getErrorMessage(err)).toBe('An unexpected error occurred');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/shared/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `backend/src/shared/errors.ts`**

```typescript
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  if (err && typeof err === 'object' && 'errors' in err) {
    const subErrors = (err as { errors: unknown[] }).errors;
    if (Array.isArray(subErrors) && subErrors.length > 0) {
      const first = subErrors[0];
      if (first instanceof Error && first.message) return first.message;
    }
  }
  return 'An unexpected error occurred';
}
```

Why this matters concretely: a real Postgres connection failure (e.g. no `DATABASE_URL` configured, or the database unreachable) surfaces from Node's networking layer as an `AggregateError` — a container for multiple underlying connection attempts (IPv4/IPv6) — whose own top-level `.message` is empty; the useful text lives in `.errors[i].message`. Without this helper, the API returns `{"error": ""}` and the frontend renders "Upload failed: " with nothing after the colon.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/shared/errors.test.ts`
Expected: all PASS.

- [ ] **Step 5: Wire it into the worker's catch block**

In `backend/src/worker/index.ts`, add `import { getErrorMessage } from '../shared/errors';` and change the final catch block from:

```typescript
} catch (err) {
  return json(400, { error: (err as Error).message });
}
```

to:

```typescript
} catch (err) {
  return json(400, { error: getErrorMessage(err) });
}
```

- [ ] **Step 6: Run the full backend suite**

Run: `cd backend && npm test`
Expected: all pass, including the existing worker test "returns 400 when a downstream call throws" (which throws a plain `new Error('boom')` — `getErrorMessage` returns `'boom'` for that case exactly as the existing assertion expects, so this test needs no change).

- [ ] **Step 7: Fix the stray `.js` build output**

`frontend/package.json`'s `build` script is currently `"tsc -b && vite build"`. There is no TypeScript project-references setup here (`frontend/tsconfig.json` has no `references`/`composite`), so `-b` (project build mode) isn't doing anything useful — it emits `.js` files next to `.ts` sources in `frontend/src` because no `outDir` is set, which is what caused the stray files Task 19 had to clean up. Change the script to:

```json
    "build": "tsc --noEmit && vite build",
```

This runs a plain type-check (emits nothing, matching the existing `typecheck` script's behavior) before Vite does the actual bundling.

- [ ] **Step 8: Verify the build no longer leaves stray files**

Run: `cd frontend && npm run build`
Expected: succeeds, produces `frontend/dist/`, and `git status` shows no new/modified `.ts`-adjacent `.js` files or `tsconfig.tsbuildinfo` under `frontend/src`.

- [ ] **Step 9: Commit**

```bash
git add backend/src/shared/errors.ts backend/src/shared/errors.test.ts backend/src/worker/index.ts frontend/package.json
git commit -m "fix: surface real error messages on DB failure, stop emitting stray build output"
```

### Task E: UI polish, at the author's request ("make it look nicer")

**Files:**
- Modify: `frontend/src/App.css` (full rewrite)
- Modify: `frontend/index.html` (one added `<link>` for a webfont)

**Interfaces:** none — pure styling, no component `.tsx` files change. Every class name below already exists in the components built in Tasks 16-19 (`upload-panel`, `stats-panel`, `stats-grid`, `stats-card`, `breach`, `banner`, `logs-table`, `logs-filters`, `pagination`) — this task only restyles them.

- [ ] **Step 1: Add a webfont link to `frontend/index.html`**

Add this line inside `<head>`, after the existing `<title>` tag:

```html
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 2: Replace `frontend/src/App.css`**

```css
:root {
  --bg: #f4f5f7;
  --surface: #ffffff;
  --border: #e2e4e9;
  --text: #1a1d23;
  --text-muted: #6b7280;
  --primary: #4f46e5;
  --danger: #dc2626;
  --danger-bg: #fef2f2;
  --danger-border: #fca5a5;
  --success-bg: #ecfdf5;
  --success-border: #6ee7b7;
  --radius: 10px;
  --shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
}

* { box-sizing: border-box; }

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  margin: 0;
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}

.app {
  max-width: 1100px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}

.app h1 {
  font-size: 26px;
  font-weight: 700;
  margin: 0 0 24px;
  letter-spacing: -0.02em;
}

.upload-panel {
  margin-bottom: 20px;
  padding: 20px 24px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.upload-panel label {
  display: block;
  font-weight: 600;
  font-size: 14px;
  margin-bottom: 10px;
}

.upload-panel input[type="file"] {
  font-size: 14px;
  padding: 8px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: #fafafb;
  width: 100%;
  cursor: pointer;
}

.upload-panel input[type="file"]:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.upload-panel p {
  margin: 10px 0 0;
  font-size: 13px;
  color: var(--text-muted);
}

.upload-panel p[role="alert"] {
  color: var(--danger);
  font-weight: 500;
}

.banner {
  padding: 10px 16px;
  background: var(--success-bg);
  border: 1px solid var(--success-border);
  border-radius: 8px;
  font-size: 14px;
  margin-bottom: 20px;
}

.stats-panel {
  margin-bottom: 24px;
}

.stats-panel > button {
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 14px;
  cursor: pointer;
  box-shadow: var(--shadow);
}

.stats-panel > button:hover {
  background: #f5f5ff;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
  gap: 14px;
  margin-top: 14px;
}

.stats-card {
  padding: 16px 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 4px solid var(--primary);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.stats-card h3 {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
}

.stats-card p {
  margin: 4px 0;
  font-size: 13px;
  color: var(--text-muted);
}

.stats-card.breach {
  border-left-color: var(--danger);
  background: var(--danger-bg);
}

.stats-card.breach h3 {
  color: var(--danger);
}

.logs-table {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 18px 20px;
}

.logs-filters {
  display: flex;
  gap: 20px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.logs-filters label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.logs-filters input,
.logs-filters select {
  font-family: inherit;
  font-size: 14px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
}

.logs-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.logs-table thead th {
  text-align: left;
  padding: 8px 10px;
  background: #f9fafb;
  border-bottom: 2px solid var(--border);
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.03em;
}

.logs-table tbody tr:nth-child(even) {
  background: #fafbfc;
}

.logs-table tbody tr:hover {
  background: #f0f1ff;
}

.logs-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.pagination {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-top: 14px;
  font-size: 13px;
}

.pagination button {
  font-family: inherit;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  cursor: pointer;
}

.pagination button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.pagination button:not(:disabled):hover {
  background: #f5f5ff;
  border-color: var(--primary);
}
```

- [ ] **Step 3: Verify visually**

Start the local backend (`cd backend && PORT=<port> npm run dev`) and frontend (`cd frontend && npm run dev`) with `frontend/.env.local` pointing at that port, open the page (via Playwright if available, otherwise describe what you'd check), and confirm: the upload panel, stats cards, and logs table all render with visible spacing/shadows/colors (not the old plain unstyled look), the breach-flagged stats card is visually distinct (red left border), and nothing overflows horizontally at a normal desktop width. Stop both servers when done.

- [ ] **Step 4: Typecheck and build**

Run: `cd frontend && npm run typecheck && npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.css frontend/index.html
git commit -m "style: polish dashboard visual design"
```

---

### Task 20 (MANUAL — first deploy needs your login): Deploy the frontend to Vercel

- [ ] **Step 1:** From `frontend/`, run `vercel login` in your own terminal (opens a browser to authenticate — cannot be done non-interactively).
- [ ] **Step 2:** Run `vercel` from `frontend/` and follow the prompts (link to a new project, accept defaults for framework detection — it should detect Vite).
- [ ] **Step 3:** In the Vercel dashboard for the new project, go to Settings → Environment Variables, add `VITE_API_BASE_URL` set to the API Gateway URL from Task 13, for the Production environment.
- [ ] **Step 4:** Redeploy to pick up the env var: `vercel --prod`.
- [ ] **Step 5:** Note the production URL Vercel prints (e.g. `https://sla-dashboard.vercel.app`) — needed for README and the verification task.

---

### Task 21: Automated live verification

**Files:** none (verification only, no code changes).

- [ ] **Step 1:** Using the Playwright browser tool, navigate to the live Vercel URL from Task 20.
- [ ] **Step 2:** Upload `monitoring_checks_9d_seed101.csv` (repo root) through the visible file input.
- [ ] **Step 3:** Take a snapshot/screenshot and confirm: the banner shows non-zero `rows_inserted`, the stats panel shows 5 service cards with uptime percentages, and `svc-reports` shows at least 1 incident (per the known injected incident in `dataset_incident_log.json`).
- [ ] **Step 4:** In the logs table, set the date range to the file's known incident window (`svc-reports day 5`, `~16:00-17:15 UTC` — check `dataset_incident_log.json` for the exact date) and confirm rows with non-200 status codes appear.
- [ ] **Step 5:** Collapse the stats panel via its toggle button and confirm it hides; expand it again.
- [ ] **Step 6:** If any step fails, fix the responsible task's code, redeploy (`sam deploy` and/or `vercel --prod`), and re-verify — do not proceed to documentation tasks until this passes.

---

## Documentation

### Task 22: README.md

**Files:**
- Create: `README.md` (repo root)

- [ ] **Step 1:** Write `README.md` covering, in this order: (1) Architecture — what runs where and why, adapted from spec section 3; (2) Data findings — the full table from spec section 6, each row as a bullet with its one-line why; (3) Assumptions — the 999-handling rule, the incident/downtime-minutes definition, the stats chosen and why, the sync-upload-over-async choice; (4) Live URLs (frontend from Task 20, API base from Task 13) and exact redeploy commands (`sam build && sam deploy` for backend, `vercel --prod` for frontend); (5) What you'd do differently, from spec section 13. Use the actual live URLs recorded in Tasks 13 and 20 — do not leave them as placeholders.
- [ ] **Step 2:** Commit.

```bash
git add README.md
git commit -m "docs: add README with architecture, data findings, and assumptions"
```

---

### Task 23: docs/architecture.md

**Files:**
- Create: `docs/architecture.md`

- [ ] **Step 1:** Write a reviewer-facing architecture document: the ASCII diagram from spec section 3, a table of components and responsibilities (frontend, upload-handler, query-handler, Postgres), a walkthrough of the data flow from CSV upload to dashboard render, and a "why this piece" paragraph per technology choice (React/Vercel, Lambda/API Gateway, Postgres/Supabase, SAM) — this can reuse and expand spec sections 2-3 now that the real deployed URLs and resource names from Tasks 13/20 are known.
- [ ] **Step 2:** Commit.

```bash
git add docs/architecture.md
git commit -m "docs: add standalone architecture document"
```

---

### Task 24: docs/interview-qa.md

**Files:**
- Create: `docs/interview-qa.md`

This is written last because it must cite real file paths and line numbers — grep/read the finished files immediately before writing each answer rather than guessing numbers.

- [ ] **Step 1:** For each question below, write a 2-4 sentence answer, and grep/read the referenced file to cite its *current* exact line number(s) (do not guess):
  1. Why does `normalizeTimestamp` in `backend/src/upload-handler/parse.ts` check `/^\d+$/` instead of trying `Date.parse` first?
  2. Walk through what happens to a row with both a negative latency and an epoch timestamp — why does `cleanRow` in `backend/src/upload-handler/clean.ts` pick the latency flag over the epoch flag?
  3. Why is status code `999` excluded from the uptime denominator in `backend/src/query-handler/stats.ts` instead of being treated as downtime?
  4. Why is the unique constraint `(service_id, ts, agent)` and not just `(service_id, ts)` — what would break if `agent` were dropped from it?
  5. Walk through the incident-count SQL in `getServiceStats` (`backend/src/query-handler/stats.ts`) — why does it use `lag()` instead of just counting rows where `is_down`?
  6. Why is `downtime_minutes` computed as `down_checks * 15` rather than from actual timestamp gaps?
  7. Why does `insertCleanedRows` in `backend/src/shared/db.ts` build one multi-row `INSERT` instead of one query per row?
  8. Why is `raw_line` stored on every row in the `checks` table?
  9. Why was a synchronous POST-to-Lambda chosen over an S3 presigned-upload + event trigger, given the files are CSVs that could in principle be large?
  10. Why Postgres/Supabase over DynamoDB for this schema, concretely in terms of the `/stats` and `/logs` queries?
  11. How does `toRangeBounds` in `backend/src/shared/dateRange.ts` turn a single selected date into a query range, and why expand it to `[start, start+1day)` rather than filter by exact date equality?
  12. What happens if the same CSV file is uploaded twice? Trace it through `cleanBatch`, `insertCleanedRows`, and the DB constraint.
  13. How is SQL injection avoided in `backend/src/query-handler/logs.ts`'s dynamically built `WHERE` clause?
  14. What was tested with mocked `pg` in `backend/src/shared/db.test.ts`, and what was deliberately left to the manual verification step (Task 21) instead?
  15. If given more time, what's the first thing you'd change about the `999` convention or the SLA threshold, and why are they hardcoded as constants right now?
- [ ] **Step 2:** Commit.

```bash
git add docs/interview-qa.md
git commit -m "docs: add anticipated interview Q&A referencing real code locations"
```
