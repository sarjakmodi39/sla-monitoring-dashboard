import { handleUpload } from '../upload-handler/index';
import { getServiceStats } from '../query-handler/stats';
import { getLogs } from '../query-handler/logs';
import { getErrorMessage } from '../shared/errors';

export interface Env {
  DATABASE_URL: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDateParam(value: string | null, name: string): string | undefined {
  if (value === null) return undefined;
  if (!DATE_RE.test(value)) throw new Error(`Invalid ${name}: expected YYYY-MM-DD`);
  return value;
}

function parsePositiveInt(value: string | null, fallback: number, name: string): number {
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid ${name}: expected a positive integer`);
  return n;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    process.env.DATABASE_URL = env.DATABASE_URL;

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    if (request.method === 'POST' && url.pathname === '/upload') {
      try {
        const csvText = await request.text();
        const result = await handleUpload(csvText);
        return json(result.statusCode, result.body);
      } catch (err) {
        return json(500, { error: getErrorMessage(err) });
      }
    }

    if (url.pathname === '/stats') {
      let from: string | undefined;
      let to: string | undefined;
      try {
        from = parseDateParam(url.searchParams.get('from'), 'from');
        to = parseDateParam(url.searchParams.get('to'), 'to');
      } catch (err) {
        return json(400, { error: (err as Error).message });
      }
      try {
        const data = await getServiceStats(from, to);
        return json(200, data);
      } catch (err) {
        return json(500, { error: getErrorMessage(err) });
      }
    }

    if (url.pathname === '/logs') {
      let from: string | undefined;
      let to: string | undefined;
      let page: number;
      let pageSize: number;
      try {
        from = parseDateParam(url.searchParams.get('from'), 'from');
        to = parseDateParam(url.searchParams.get('to'), 'to');
        page = parsePositiveInt(url.searchParams.get('page'), 1, 'page');
        pageSize = parsePositiveInt(url.searchParams.get('page_size'), 50, 'page_size');
      } catch (err) {
        return json(400, { error: (err as Error).message });
      }
      try {
        const data = await getLogs({
          from,
          to,
          service: url.searchParams.get('service') ?? undefined,
          page,
          pageSize,
        });
        return json(200, data);
      } catch (err) {
        return json(500, { error: getErrorMessage(err) });
      }
    }

    return json(404, { error: `Unknown route: ${url.pathname}` });
  },
};
