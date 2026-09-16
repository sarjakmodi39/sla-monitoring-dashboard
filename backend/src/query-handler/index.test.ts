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
