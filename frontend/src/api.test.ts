import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest';
import { uploadCsv, fetchStats, fetchLogs } from './api';

let fetchMock: MockedFunction<typeof fetch>;

beforeEach(() => {
  fetchMock = vi.fn() as MockedFunction<typeof fetch>;
  vi.stubGlobal('fetch', fetchMock);
});

class FakeXhr {
  static instances: FakeXhr[] = [];
  method = '';
  url = '';
  status = 200;
  responseText = '{}';
  requestBody: unknown;
  headers: Record<string, string> = {};
  upload = { onload: null as (() => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value;
  }

  send(body: unknown) {
    this.requestBody = body;
  }
}

describe('api client', () => {
  it('uploadCsv posts the file text as text/csv, signals upload then processing, and returns the parsed JSON', async () => {
    FakeXhr.instances = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr as unknown as typeof XMLHttpRequest);
    const file = new File(['a,b\n1,2'], 'test.csv', { type: 'text/csv' });
    const stages: string[] = [];

    const resultPromise = uploadCsv(file, (stage) => stages.push(stage));
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const xhr = FakeXhr.instances[0];

    expect(xhr.method).toBe('POST');
    expect(xhr.url).toContain('/upload');
    expect(xhr.headers['Content-Type']).toBe('text/csv');
    expect(xhr.requestBody).toBe('a,b\n1,2');

    xhr.upload.onload?.();
    xhr.status = 200;
    xhr.responseText = JSON.stringify({ rows_received: 1 });
    xhr.onload?.();

    const result = await resultPromise;
    expect(stages).toEqual(['uploading', 'processing']);
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
