import { describe, it, expect, vi } from 'vitest';
import { handleUpload } from './index';

describe('handleUpload', () => {
  const header = 'service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region';
  const line = 'svc-auth,auth-api,2025-05-13T12:45:00Z,200,181,ms,agent-1,ap-south-1';

  it('returns 400 for an empty body', async () => {
    const result = await handleUpload('');
    expect(result.statusCode).toBe(400);
  });

  it('returns 400 when the CSV header is wrong', async () => {
    const result = await handleUpload('wrong,header\nfoo,bar');
    expect(result.statusCode).toBe(400);
  });

  it('cleans, inserts, and summarizes a valid upload', async () => {
    const fakeInsert = vi.fn().mockResolvedValue({ inserted: 1, duplicates: 0 });
    const result = await handleUpload(`${header}\n${line}`, fakeInsert);

    expect(result.statusCode).toBe(200);
    expect(fakeInsert).toHaveBeenCalledTimes(1);
    expect(result.body).toMatchObject({
      rows_received: 1,
      rows_inserted: 1,
      rows_duplicate: 0,
      rows_skipped: 0,
    });
  });
});
