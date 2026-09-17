import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CleanedCheckRow } from './types';

const connectMock = vi.fn();
const endMock = vi.fn();
const queryMock = vi.fn();
vi.mock('pg', () => ({
  Client: vi.fn(() => ({ connect: connectMock, query: queryMock, end: endMock })),
}));

function makeRow(i: number): CleanedCheckRow {
  return {
    service_id: `svc-${i}`,
    service_name: 'test-api',
    ts: '2025-05-13T12:45:00.000Z',
    status_code: 200,
    latency_ms: 100,
    agent: 'agent-1',
    region: 'ap-south-1',
    data_quality_flag: null,
    raw_line: 'raw',
  };
}

beforeEach(() => {
  connectMock.mockReset();
  queryMock.mockReset();
  endMock.mockReset();
});

describe('insertCleanedRows', () => {
  it('returns zero counts for an empty batch without connecting', async () => {
    const { insertCleanedRows } = await import('./db');
    const result = await insertCleanedRows([]);
    expect(result).toEqual({ inserted: 0, duplicates: 0 });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('builds a parameterized multi-row insert and reports duplicates from the row-count gap', async () => {
    queryMock.mockResolvedValue({ rowCount: 1 });
    const { insertCleanedRows } = await import('./db');
    const result = await insertCleanedRows([makeRow(1), makeRow(2)]);

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [sql, values] = queryMock.mock.calls[0];
    expect(sql).toContain('on conflict (service_id, ts, agent) do nothing');
    expect(values).toHaveLength(18);
    expect(endMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ inserted: 1, duplicates: 1 });
  });

  it('splits more than 1000 rows into multiple batched queries over one connection', async () => {
    queryMock.mockResolvedValueOnce({ rowCount: 1000 }).mockResolvedValueOnce({ rowCount: 500 });
    const { insertCleanedRows } = await import('./db');
    const rows = Array.from({ length: 1500 }, (_, i) => makeRow(i));
    const result = await insertCleanedRows(rows);

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(queryMock.mock.calls[0][1]).toHaveLength(1000 * 9);
    expect(queryMock.mock.calls[1][1]).toHaveLength(500 * 9);
    expect(endMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ inserted: 1500, duplicates: 0 });
  });

  it('ends the client even if a query throws', async () => {
    queryMock.mockRejectedValue(new Error('boom'));
    const { insertCleanedRows } = await import('./db');
    await expect(insertCleanedRows([makeRow(1)])).rejects.toThrow('boom');
    expect(endMock).toHaveBeenCalledTimes(1);
  });
});
