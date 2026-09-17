const BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

export interface UploadResponse {
  rows_received: number;
  rows_inserted: number;
  rows_duplicate: number;
  rows_skipped: number;
  flags_summary: Record<string, number>;
}

export interface ServiceStats {
  service_id: string;
  service_name: string;
  uptime_pct: number;
  breaches_slo: boolean;
  incident_count: number;
  downtime_minutes: number;
  avg_latency_ms: number | null;
  p95_latency_ms: number | null;
  check_failures: number;
}

export interface StatsResponse {
  overall: { total_services: number; services_breaching_slo: number };
  by_service: ServiceStats[];
}

export interface LogRow {
  id: number;
  service_id: string;
  service_name: string;
  ts: string;
  status_code: number;
  latency_ms: number | null;
  agent: string;
  region: string;
  data_quality_flag: string | null;
}

export interface LogsResponse {
  rows: LogRow[];
  total: number;
  page: number;
  page_size: number;
}

async function parseErrorOrThrow(res: Response): Promise<never> {
  const body = await res.json().catch(() => ({}));
  throw new Error(body.error ?? `Request failed with status ${res.status}`);
}

export async function uploadCsv(file: File): Promise<UploadResponse> {
  const text = await file.text();
  const res = await fetch(`${BASE_URL}/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/csv' },
    body: text,
  });
  if (!res.ok) return parseErrorOrThrow(res);
  return res.json();
}

export async function fetchStats(from?: string, to?: string): Promise<StatsResponse> {
  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const res = await fetch(`${BASE_URL}/stats?${params.toString()}`);
  if (!res.ok) return parseErrorOrThrow(res);
  return res.json();
}

export async function fetchLogs(opts: {
  from?: string;
  to?: string;
  service?: string;
  page: number;
  pageSize: number;
}): Promise<LogsResponse> {
  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.service) params.set('service', opts.service);
  params.set('page', String(opts.page));
  params.set('page_size', String(opts.pageSize));
  const res = await fetch(`${BASE_URL}/logs?${params.toString()}`);
  if (!res.ok) return parseErrorOrThrow(res);
  return res.json();
}
