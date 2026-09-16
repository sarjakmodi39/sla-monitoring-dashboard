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
