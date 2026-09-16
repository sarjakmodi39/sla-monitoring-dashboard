import type { RawCheckRow, DataQualityFlag } from '../shared/types';

const EXPECTED_HEADER = [
  'service_id', 'service_name', 'timestamp', 'status_code',
  'latency', 'latency_unit', 'agent', 'region',
];

export function parseCsv(text: string): { raw: RawCheckRow; rawLine: string }[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error('CSV is empty');
  }
  const header = lines[0].split(',').map((h) => h.trim());
  if (header.join(',') !== EXPECTED_HEADER.join(',')) {
    throw new Error(`Unexpected CSV header: ${lines[0]}`);
  }
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const raw: RawCheckRow = {
      service_id: cols[0] ?? '',
      service_name: cols[1] ?? '',
      timestamp: cols[2] ?? '',
      status_code: cols[3] ?? '',
      latency: cols[4] ?? '',
      latency_unit: cols[5] ?? '',
      agent: cols[6] ?? '',
      region: cols[7] ?? '',
    };
    return { raw, rawLine: line };
  });
}

export function normalizeTimestamp(raw: string): { iso: string | null; wasEpoch: boolean } {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const date = new Date(Number(trimmed) * 1000);
    return { iso: isNaN(date.getTime()) ? null : date.toISOString(), wasEpoch: true };
  }
  const date = new Date(trimmed);
  return { iso: isNaN(date.getTime()) ? null : date.toISOString(), wasEpoch: false };
}

export function normalizeLatency(
  raw: string,
  unit: string,
): { ms: number | null; flag: DataQualityFlag | null } {
  const trimmed = raw.trim();
  if (trimmed === '' || isNaN(Number(trimmed))) {
    return { ms: null, flag: 'missing_latency' };
  }
  const value = Number(trimmed);
  const isSeconds = unit.trim() === 's';
  const ms = isSeconds ? value * 1000 : value;
  if (ms < 0) {
    return { ms: null, flag: 'negative_latency_nulled' };
  }
  return { ms, flag: isSeconds ? 'unit_converted' : null };
}
