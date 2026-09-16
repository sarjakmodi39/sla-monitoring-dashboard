import { parseCsv, normalizeTimestamp, normalizeLatency } from './parse';
import type { CleanedCheckRow, CleanResult, DataQualityFlag, RawCheckRow } from '../shared/types';

export function cleanRow(raw: RawCheckRow, rawLine: string): CleanedCheckRow | null {
  if (!raw.service_id || !raw.service_name || !raw.agent || !raw.region) {
    return null;
  }
  const { iso, wasEpoch } = normalizeTimestamp(raw.timestamp);
  if (iso === null) return null;

  const statusCode = Number(raw.status_code);
  if (isNaN(statusCode)) return null;

  const { ms, flag: latencyFlag } = normalizeLatency(raw.latency, raw.latency_unit);
  const flag: DataQualityFlag | null = latencyFlag ?? (wasEpoch ? 'epoch_timestamp' : null);

  return {
    service_id: raw.service_id,
    service_name: raw.service_name,
    ts: iso,
    status_code: statusCode,
    latency_ms: ms,
    agent: raw.agent,
    region: raw.region,
    data_quality_flag: flag,
    raw_line: rawLine,
  };
}

export function cleanBatch(csvText: string): CleanResult {
  const parsed = parseCsv(csvText);
  const rows: CleanedCheckRow[] = [];
  const flagsSummary: Record<DataQualityFlag, number> = {
    epoch_timestamp: 0,
    unit_converted: 0,
    missing_latency: 0,
    negative_latency_nulled: 0,
  };
  let skipped = 0;

  for (const { raw, rawLine } of parsed) {
    const row = cleanRow(raw, rawLine);
    if (row === null) {
      skipped++;
      continue;
    }
    if (row.data_quality_flag) flagsSummary[row.data_quality_flag]++;
    rows.push(row);
  }

  return { rows, rows_received: parsed.length, rows_skipped: skipped, flags_summary: flagsSummary };
}
