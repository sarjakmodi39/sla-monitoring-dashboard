import http from 'node:http';
import worker from '../src/worker/index';

const PORT = Number(process.env.PORT ?? 3001);
const env = { DATABASE_URL: process.env.DATABASE_URL ?? '' };

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);

  // Forbidden/connection-management headers can't be set on a fetch Request;
  // the worker only reads Content-Type, so forward just that (if present).
  const forwardedHeaders: HeadersInit = {};
  const contentType = req.headers['content-type'];
  if (contentType) forwardedHeaders['Content-Type'] = contentType;

  const request = new Request(new URL(req.url ?? '/', `http://localhost:${PORT}`), {
    method: req.method,
    headers: forwardedHeaders,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });

  try {
    const response = await worker.fetch(request, env);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: (err as Error).message }));
  }
});

server.listen(PORT, () => {
  console.log(`Local dev API listening on http://localhost:${PORT}`);
  console.log('Routes: POST /upload, GET /stats, GET /logs');
  console.log('Requires DATABASE_URL env var pointing at a real Postgres (e.g. Supabase).');
});
