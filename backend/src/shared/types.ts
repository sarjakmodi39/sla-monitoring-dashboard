export type DataQualityFlag =
  | 'epoch_timestamp'
  | 'unit_converted'
  | 'missing_latency'
  | 'negative_latency_nulled';

export interface RawCheckRow {
  service_id: string;
  service_name: string;
  timestamp: string;
  status_code: string;
  latency: string;
  latency_unit: string;
  agent: string;
  region: string;
}

export interface CleanedCheckRow {
  service_id: string;
  service_name: string;
  ts: string; // ISO-8601 UTC
  status_code: number;
  latency_ms: number | null;
  agent: string;
  region: string;
  data_quality_flag: DataQualityFlag | null;
  raw_line: string;
}

export interface CleanResult {
  rows: CleanedCheckRow[];
  rows_received: number;
  rows_skipped: number;
  flags_summary: Record<DataQualityFlag, number>;
}
