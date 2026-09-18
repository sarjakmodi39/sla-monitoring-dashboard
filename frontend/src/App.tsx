import { useEffect, useState, useCallback } from 'react';
import UploadPanel from './components/UploadPanel';
import StatsPanel from './components/StatsPanel';
import LogsTable from './components/LogsTable';
import { fetchStats, fetchLogs, type StatsResponse, type LogsResponse } from './api';

const PAGE_SIZE = 25;

export default function App() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [service, setService] = useState('');
  const [page, setPage] = useState(1);

  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(null);
    try {
      setStats(await fetchStats(from || undefined, to || undefined));
    } catch (err) {
      setStatsError((err as Error).message);
    } finally {
      setStatsLoading(false);
    }
  }, [from, to]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      setLogs(await fetchLogs({ from: from || undefined, to: to || undefined, service: service || undefined, page, pageSize: PAGE_SIZE }));
    } catch (err) {
      setLogsError((err as Error).message);
    } finally {
      setLogsLoading(false);
    }
  }, [from, to, service, page]);

  useEffect(() => { void loadStats(); }, [loadStats]);
  useEffect(() => { void loadLogs(); }, [loadLogs]);

  const services = (stats?.by_service ?? []).map((s) => ({ id: s.service_id, name: s.service_name }));

  return (
    <main className="app">
      <header className="app-header">
        <h1>SLA Monitoring Dashboard</h1>
        <p className="app-subtitle">Upload health-check data and review service uptime, incidents, and raw logs.</p>
      </header>
      <UploadPanel
        onUploaded={(summary) => {
          setBanner(
            `Inserted ${summary.rows_inserted}, duplicates ${summary.rows_duplicate}, skipped ${summary.rows_skipped}.`,
          );
          void loadStats();
          void loadLogs();
        }}
      />
      {banner && <p className="banner">{banner}</p>}
      {statsError && <p className="section-error" role="alert">Failed to load stats: {statsError}</p>}
      <StatsPanel stats={stats} loading={statsLoading} />
      {logsError && <p className="section-error" role="alert">Failed to load logs: {logsError}</p>}
      <LogsTable
        logs={logs}
        loading={logsLoading}
        from={from}
        to={to}
        service={service}
        services={services}
        onFromChange={(v) => { setFrom(v); setPage(1); }}
        onToChange={(v) => { setTo(v); setPage(1); }}
        onServiceChange={(v) => { setService(v); setPage(1); }}
        onPageChange={setPage}
      />
    </main>
  );
}
