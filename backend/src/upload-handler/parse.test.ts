import { describe, it, expect } from 'vitest';
import { parseCsv, normalizeTimestamp, normalizeLatency } from './parse';

describe('parseCsv', () => {
  const header = 'service_id,service_name,timestamp,status_code,latency,latency_unit,agent,region';

  it('parses rows and keeps the original line', () => {
    const line = 'svc-auth,auth-api,2025-05-13T12:45:00Z,200,181,ms,agent-1,ap-south-1';
    const result = parseCsv(`${header}\n${line}`);
    expect(result).toHaveLength(1);
    expect(result[0].raw.service_id).toBe('svc-auth');
    expect(result[0].raw.status_code).toBe('200');
    expect(result[0].rawLine).toBe(line);
  });

  it('throws on an unexpected header', () => {
    expect(() => parseCsv('wrong,header\nfoo,bar')).toThrow(/Unexpected CSV header/);
  });

  it('skips blank lines', () => {
    const line = 'svc-auth,auth-api,2025-05-13T12:45:00Z,200,181,ms,agent-1,ap-south-1';
    const result = parseCsv(`${header}\n${line}\n\n`);
    expect(result).toHaveLength(1);
  });
});

describe('normalizeTimestamp', () => {
  it('passes through a valid ISO-8601 timestamp', () => {
    const result = normalizeTimestamp('2025-05-13T12:45:00Z');
    expect(result.iso).toBe('2025-05-13T12:45:00.000Z');
    expect(result.wasEpoch).toBe(false);
  });

  it('converts a raw Unix epoch-seconds value', () => {
    const result = normalizeTimestamp('1746938700');
    expect(result.iso).toBe(new Date(1746938700 * 1000).toISOString());
    expect(result.wasEpoch).toBe(true);
  });

  it('returns null iso for garbage input', () => {
    const result = normalizeTimestamp('not-a-date');
    expect(result.iso).toBeNull();
  });
});

describe('normalizeLatency', () => {
  it('keeps a plain ms value unchanged', () => {
    expect(normalizeLatency('707', 'ms')).toEqual({ ms: 707, flag: null });
  });

  it('converts seconds to milliseconds and flags it', () => {
    expect(normalizeLatency('0.717', 's')).toEqual({ ms: 717, flag: 'unit_converted' });
  });

  it('flags a missing value as missing_latency', () => {
    expect(normalizeLatency('', 'ms')).toEqual({ ms: null, flag: 'missing_latency' });
  });

  it('nulls out a negative value and flags it', () => {
    expect(normalizeLatency('-296', 'ms')).toEqual({ ms: null, flag: 'negative_latency_nulled' });
  });
});
