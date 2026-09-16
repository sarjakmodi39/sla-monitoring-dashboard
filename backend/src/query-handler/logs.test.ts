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
