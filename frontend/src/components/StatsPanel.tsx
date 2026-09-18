import { useState } from 'react';
import type { ServiceStats, StatsResponse } from '../api';

const MINOR_BREACH_FLOOR = 99.5;

function severityClass(s: ServiceStats): string {
  if (!s.breaches_slo) return 'stats-card healthy';
  return s.uptime_pct >= MINOR_BREACH_FLOOR ? 'stats-card breach-minor' : 'stats-card breach-major';
}

function severityLabel(s: ServiceStats): string | null {
  if (!s.breaches_slo) return null;
  return s.uptime_pct >= MINOR_BREACH_FLOOR ? 'SLA breach' : 'SLA breach — critical';
}

export default function StatsPanel({ stats, loading }: { stats: StatsResponse | null; loading: boolean }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="stats-panel">
      <div className="stats-panel-header">
        {stats && !loading && (
          <p className="overall-summary">
            <strong>{stats.overall.services_breaching_slo}</strong> of{' '}
            <strong>{stats.overall.total_services}</strong> services breaching SLA
          </p>
        )}
        <button onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          {expanded ? 'Hide stats' : 'Show stats'}
        </button>
      </div>
      {expanded && (
        <div>
          {loading && (
            <div className="stats-grid">
              {[0, 1, 2].map((i) => <div key={i} className="stats-card skeleton" />)}
            </div>
          )}
          {!loading && stats && stats.by_service.length === 0 && (
            <p className="empty-state">No data for this range.</p>
          )}
          {!loading && stats && stats.by_service.length > 0 && (
            <div className="stats-grid">
              {stats.by_service.map((s) => (
                <div key={s.service_id} className={severityClass(s)}>
                  <div className="stats-card-head">
                    <h3>{s.service_name}</h3>
                    {severityLabel(s) && <span className="severity-tag">{severityLabel(s)}</span>}
                  </div>
                  <p className="uptime-value">{s.uptime_pct}%<span className="uptime-label">uptime</span></p>
                  <dl className="stats-facts">
                    <div><dt>Incidents</dt><dd>{s.incident_count} ({s.downtime_minutes} min down)</dd></div>
                    <div><dt>Latency</dt><dd>{s.avg_latency_ms ?? '—'} ms avg / {s.p95_latency_ms ?? '—'} ms p95</dd></div>
                    <div><dt>Check failures</dt><dd>{s.check_failures}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
