import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest';
import { uploadCsv, fetchStats, fetchLogs } from './api';

let fetchMock: MockedFunction<typeof fetch>;

beforeEach(() => {
  fetchMock = vi.fn() as MockedFunction<typeof fetch>;
  vi.stubGlobal('fetch', fetchMock);
});

describe('api client', () => {
  it('uploadCsv posts the file text as text/csv and returns the parsed JSON', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rows_received: 1 }) } as Response);
    const file = new File(['a,b\n1,2'], 'test.csv', { type: 'text/csv' });

    const result = await uploadCsv(file);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/upload'),
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'text/csv' } }),
    );
    expect(result).toEqual({ rows_received: 1 });
  });

  it('fetchStats builds query params only for provided dates', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ overall: {}, by_service: [] }) } as Response);
    await fetchStats('2025-05-01', '2025-05-02');
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain('from=2025-05-01');
    expect(calledUrl).toContain('to=2025-05-02');
  });

  it('fetchLogs throws on a non-ok response', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'bad request' }) } as Response);
    await expect(fetchLogs({ page: 1, pageSize: 10 })).rejects.toThrow('bad request');
  });
});
