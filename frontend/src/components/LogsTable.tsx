import type { LogsResponse } from '../api';

export default function LogsTable({
  logs, loading, from, to, service,
  onFromChange, onToChange, onServiceChange, onPageChange,
}: {
  logs: LogsResponse | null;
  loading: boolean;
  from: string;
  to: string;
  service: string;
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
            <option value="">All</option>
            <option value="svc-auth">svc-auth</option>
            <option value="svc-payments">svc-payments</option>
            <option value="svc-search">svc-search</option>
            <option value="svc-notify">svc-notify</option>
            <option value="svc-reports">svc-reports</option>
          </select>
        </label>
      </div>

      {loading && <p>Loading logs...</p>}
      {!loading && logs && (
        <>
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
                  <td>{r.ts}</td>
                  <td>{r.service_name}</td>
                  <td>{r.status_code}</td>
                  <td>{r.latency_ms ?? '—'}</td>
                  <td>{r.agent}</td>
                  <td>{r.region}</td>
                  <td>{r.data_quality_flag ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
