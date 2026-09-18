import type { LogsResponse } from '../api';

function statusClass(code: number): string {
  if (code === 999) return 'status-badge status-check-failure';
  if (code >= 500) return 'status-badge status-error';
  if (code >= 400) return 'status-badge status-warn';
  return 'status-badge status-ok';
}

export default function LogsTable({
  logs, loading, from, to, service, services,
  onFromChange, onToChange, onServiceChange, onPageChange,
}: {
  logs: LogsResponse | null;
  loading: boolean;
  from: string;
  to: string;
  service: string;
  services: { id: string; name: string }[];
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onServiceChange: (v: string) => void;
  onPageChange: (page: number) => void;
}) {
  const totalPages = logs ? Math.max(1, Math.ceil(logs.total / logs.page_size)) : 1;

  return (
    <section className="logs-table">
      <div className="logs-filters">
        <label>
          From <input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} />
        </label>
        <label>
          To <input type="date" value={to} onChange={(e) => onToChange(e.target.value)} />
        </label>
        <label>
          Service
          <select value={service} onChange={(e) => onServiceChange(e.target.value)}>
            <option value="">All services</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>

      {loading && (
        <div className="table-skeleton">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="skeleton-row" />)}
        </div>
      )}
      {!loading && logs && logs.rows.length === 0 && <p className="empty-state">No logs for this filter.</p>}
      {!loading && logs && logs.rows.length > 0 && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Timestamp</th><th>Service</th><th>Status</th><th>Latency (ms)</th>
                  <th>Agent</th><th>Region</th><th>Quality flag</th>
                </tr>
              </thead>
              <tbody>
                {logs.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="mono">{r.ts}</td>
                    <td>{r.service_name}</td>
                    <td><span className={statusClass(r.status_code)}>{r.status_code}</span></td>
                    <td className="mono">{r.latency_ms ?? '—'}</td>
                    <td>{r.agent}</td>
                    <td>{r.region}</td>
                    <td>{r.data_quality_flag ? <span className="flag-pill">{r.data_quality_flag}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination">
            <button disabled={logs.page <= 1} onClick={() => onPageChange(logs.page - 1)}>Previous</button>
            <span>Page {logs.page} of {totalPages}</span>
            <button disabled={logs.page >= totalPages} onClick={() => onPageChange(logs.page + 1)}>Next</button>
          </div>
        </>
      )}
    </section>
  );
}
