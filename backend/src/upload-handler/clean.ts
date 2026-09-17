import { parseCsv, normalizeTimestamp, normalizeLatency } from './parse';
import type { CleanedCheckRow, CleanResult, DataQualityFlag, RawCheckRow } from '../shared/types';

export function cleanRow(raw: RawCheckRow, rawLine: string): CleanedCheckRow | null {
  if (!raw.service_id || !raw.service_name || !raw.agent || !raw.region) {
    return null;
  }
  const { iso, wasEpoch } = normalizeTimestamp(raw.timestamp);
  if (iso === null) return null;

  if (!/^\d+$/.test(raw.status_code.trim())) return null;
  const statusCode = Number(raw.status_code);

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
    rows.push(row);

    // Count every applicable issue for accurate reporting, even though only
    // one is stored per row on `data_quality_flag` (latency issues take
    // storage priority — see cleanRow).
    const { wasEpoch } = normalizeTimestamp(raw.timestamp);
    if (wasEpoch) flagsSummary.epoch_timestamp++;
    const { flag: latencyFlag } = normalizeLatency(raw.latency, raw.latency_unit);
    if (latencyFlag) flagsSummary[latencyFlag]++;
  }

  return { rows, rows_received: parsed.length, rows_skipped: skipped, flags_summary: flagsSummary };
}
