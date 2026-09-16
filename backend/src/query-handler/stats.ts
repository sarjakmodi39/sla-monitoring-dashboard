import { getPool } from '../shared/db';
import { toRangeBounds } from '../shared/dateRange';

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

export interface OverallStats {
  total_services: number;
  services_breaching_slo: number;
}

const SLO_THRESHOLD_PCT = 99.9;
const CHECK_INTERVAL_MINUTES = 15;

export async function getServiceStats(
  from?: string,
  to?: string,
): Promise<{ overall: OverallStats; by_service: ServiceStats[] }> {
  const { start, end } = toRangeBounds(from, to);
  const pool = getPool();

  const aggregate = await pool.query(
    `select
       service_id, service_name,
       count(*) filter (where status_code != 999) as total_checks,
       count(*) filter (where status_code < 400 and status_code != 999) as up_checks,
       count(*) filter (where status_code >= 400 and status_code != 999) as down_checks,
       count(*) filter (where status_code = 999) as check_failures,
       avg(latency_ms) as avg_latency_ms,
       percentile_cont(0.95) within group (order by latency_ms) as p95_latency_ms
     from checks
     where ts >= $1 and ts < $2
     group by service_id, service_name`,
    [start, end],
  );

  const incidents = await pool.query(
    `with flagged as (
       select service_id, ts,
         (status_code >= 400 and status_code != 999) as is_down,
         lag(status_code >= 400 and status_code != 999) over (partition by service_id order by ts) as prev_down
       from checks
       where ts >= $1 and ts < $2
     )
     select service_id, count(*) as incident_count
     from flagged
     where is_down and (prev_down is distinct from true)
     group by service_id`,
    [start, end],
  );

  const incidentCounts = new Map<string, number>(
    incidents.rows.map((r: { service_id: string; incident_count: string }) => [
      r.service_id,
      Number(r.incident_count),
    ]),
  );

  const byService: ServiceStats[] = aggregate.rows.map((r: {
    service_id: string; service_name: string; total_checks: string;
    up_checks: string; down_checks: string; check_failures: string;
    avg_latency_ms: string | null; p95_latency_ms: string | null;
  }) => {
    const totalChecks = Number(r.total_checks);
    const upChecks = Number(r.up_checks);
    const downChecks = Number(r.down_checks);
    const uptimePct = totalChecks === 0 ? 100 : Math.round((upChecks / totalChecks) * 100000) / 1000;

    return {
      service_id: r.service_id,
      service_name: r.service_name,
      uptime_pct: uptimePct,
      breaches_slo: uptimePct < SLO_THRESHOLD_PCT,
      incident_count: incidentCounts.get(r.service_id) ?? 0,
      downtime_minutes: downChecks * CHECK_INTERVAL_MINUTES,
      avg_latency_ms: r.avg_latency_ms === null ? null : Math.round(Number(r.avg_latency_ms)),
      p95_latency_ms: r.p95_latency_ms === null ? null : Math.round(Number(r.p95_latency_ms)),
      check_failures: Number(r.check_failures),
    };
  });

  return {
    overall: {
      total_services: byService.length,
      services_breaching_slo: byService.filter((s) => s.breaches_slo).length,
    },
    by_service: byService,
  };
}
