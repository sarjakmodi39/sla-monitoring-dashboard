import { describe, it, expect } from 'vitest';
import { cleanRow, cleanBatch } from './clean';
import type { RawCheckRow } from '../shared/types';

const base: RawCheckRow = {
  service_id: 'svc-auth',
  service_name: 'auth-api',
  timestamp: '2025-05-13T12:45:00Z',
  status_code: '200',
  latency: '181',
  latency_unit: 'ms',
  agent: 'agent-1',
  region: 'ap-south-1',
};

describe('cleanRow', () => {
  it('cleans a well-formed row with no flag', () => {
    const result = cleanRow(base, 'raw-line');
    expect(result).toMatchObject({
      service_id: 'svc-auth',
      status_code: 200,
      latency_ms: 181,
      data_quality_flag: null,
    });
  });

  it('returns null when a required field is missing', () => {
    const result = cleanRow({ ...base, service_id: '' }, 'raw-line');
    expect(result).toBeNull();
  });

  it('returns null when the timestamp is unparseable', () => {
    const result = cleanRow({ ...base, timestamp: 'garbage' }, 'raw-line');
    expect(result).toBeNull();
  });

  it('keeps status 999 as-is with no flag', () => {
    const result = cleanRow({ ...base, status_code: '999' }, 'raw-line');
    expect(result?.status_code).toBe(999);
    expect(result?.data_quality_flag).toBeNull();
  });

  it('prefers the latency flag over the epoch flag when both apply', () => {
    const result = cleanRow({ ...base, timestamp: '1746938700', latency: '-5' }, 'raw-line');
    expect(result?.data_quality_flag).toBe('negative_latency_nulled');
  });

  it('returns null when status_code is blank rather than treating it as 0', () => {
    const result = cleanRow({ ...base, status_code: '' }, 'raw-line');
    expect(result).toBeNull();
  });

  it('returns null when status_code has non-digit characters', () => {
    const result = cleanRow({ ...base, status_code: '2xx' }, 'raw-line');
    expect(result).toBeNull();
  });
});

describe('cleanBatch', () => {
  const header = 'service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region';

  it('counts received, skipped, and flag totals', () => {
    const goodLine = 'svc-auth,auth-api,2025-05-13T12:45:00Z,200,181,ms,agent-1,ap-south-1';
    const epochLine = 'svc-search,search-api,1746938700,200,0.717,s,agent-1,ap-south-1';
    const badLine = ',auth-api,2025-05-13T12:45:00Z,200,181,ms,agent-1,ap-south-1';
    const csv = `${header}\n${goodLine}\n${epochLine}\n${badLine}`;

    const result = cleanBatch(csv);

    expect(result.rows_received).toBe(3);
    expect(result.rows_skipped).toBe(1);
    expect(result.rows).toHaveLength(2);
    expect(result.flags_summary.unit_converted).toBe(1);
    expect(result.flags_summary.epoch_timestamp).toBe(1);
  });
});
