import { describe, it, expect, vi } from 'vitest';

vi.mock('../upload-handler/index', () => ({ handleUpload: vi.fn() }));
vi.mock('../query-handler/stats', () => ({ getServiceStats: vi.fn() }));
vi.mock('../query-handler/logs', () => ({ getLogs: vi.fn() }));

import worker from './index';
import { handleUpload } from '../upload-handler/index';
import { getServiceStats } from '../query-handler/stats';
import { getLogs } from '../query-handler/logs';
import type { Env } from './index';

const env: Env = { DATABASE_URL: 'postgres://test' };

describe('worker fetch', () => {
  it('routes POST /upload to handleUpload with the request body text', async () => {
    vi.mocked(handleUpload).mockResolvedValue({ statusCode: 200, body: { rows_received: 1 } });
    const req = new Request('https://worker.example/upload', { method: 'POST', body: 'a,b\n1,2' });
    const res = await worker.fetch(req, env);
    expect(handleUpload).toHaveBeenCalledWith('a,b\n1,2');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows_received: 1 });
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });

  it('routes GET /stats with parsed query params', async () => {
    vi.mocked(getServiceStats).mockResolvedValue({
      overall: { total_services: 1, services_breaching_slo: 0 },
      by_service: [],
    });
    const req = new Request('https://worker.example/stats?from=2025-05-01&to=2025-05-02');
    const res = await worker.fetch(req, env);
    expect(getServiceStats).toHaveBeenCalledWith('2025-05-01', '2025-05-02');
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('responds to OPTIONS preflight with CORS headers and no body', async () => {
    const req = new Request('https://worker.example/upload', { method: 'OPTIONS' });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('routes GET /logs with parsed pagination', async () => {
    vi.mocked(getLogs).mockResolvedValue({ rows: [], total: 0, page: 2, page_size: 25 });
    const req = new Request('https://worker.example/logs?service=svc-auth&page=2&page_size=25');
    const res = await worker.fetch(req, env);
    expect(getLogs).toHaveBeenCalledWith({ from: undefined, to: undefined, service: 'svc-auth', page: 2, pageSize: 25 });
    expect(res.status).toBe(200);
  });

  it('returns 404 for an unknown route', async () => {
    const req = new Request('https://worker.example/nope');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(404);
  });

  it('returns 400 when a downstream call throws', async () => {
    vi.mocked(getServiceStats).mockRejectedValue(new Error('boom'));
    const req = new Request('https://worker.example/stats');
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'boom' });
  });
});
