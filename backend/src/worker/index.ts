import { handleUpload } from '../upload-handler/index';
import { getServiceStats } from '../query-handler/stats';
import { getLogs } from '../query-handler/logs';
import { getErrorMessage } from '../shared/errors';

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
      return json(400, { error: getErrorMessage(err) });
    }
  },
};
