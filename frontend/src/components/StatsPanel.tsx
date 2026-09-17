import { useState } from 'react';
import type { StatsResponse } from '../api';

export default function StatsPanel({ stats, loading }: { stats: StatsResponse | null; loading: boolean }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <section className="stats-panel">
      <button onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        {expanded ? 'Hide' : 'Show'} stats
      </button>
      {expanded && (
        <div>
          {loading && <p>Loading stats...</p>}
          {!loading && stats && stats.by_service.length === 0 && <p>No data for this range.</p>}
          {!loading && stats && (
            <div className="stats-grid">
              {stats.by_service.map((s) => (
                <div key={s.service_id} className={s.breaches_slo ? 'stats-card breach' : 'stats-card'}>
                  <h3>{s.service_name}</h3>
                  <p>Uptime: {s.uptime_pct}%{s.breaches_slo ? ' — SLA BREACH' : ''}</p>
                  <p>Incidents: {s.incident_count} ({s.downtime_minutes} min downtime)</p>
                  <p>Avg latency: {s.avg_latency_ms ?? '—'} ms (p95: {s.p95_latency_ms ?? '—'} ms)</p>
                  <p>Check failures: {s.check_failures}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
