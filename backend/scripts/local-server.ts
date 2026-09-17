import http from 'node:http';
import { handler as uploadHandler } from '../src/upload-handler';
import { handler as queryHandler } from '../src/query-handler';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const PORT = Number(process.env.PORT ?? 3001);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

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
  const body = Buffer.concat(chunks).toString('utf-8');

  const event = {
    rawPath: url.pathname,
    queryStringParameters: Object.fromEntries(url.searchParams),
    body,
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;

  try {
    const result =
      req.method === 'POST' && url.pathname === '/upload'
        ? await uploadHandler(event)
        : await queryHandler(event);

    res.writeHead(result.statusCode ?? 200, { 'Content-Type': 'application/json' });
    res.end(typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
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
