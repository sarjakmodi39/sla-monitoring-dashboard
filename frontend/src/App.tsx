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
  const [logs, setLogs] = useState<LogsResponse | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      setStats(await fetchStats(from || undefined, to || undefined));
    } finally {
      setStatsLoading(false);
    }
  }, [from, to]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      setLogs(await fetchLogs({ from: from || undefined, to: to || undefined, service: service || undefined, page, pageSize: PAGE_SIZE }));
    } finally {
      setLogsLoading(false);
    }
  }, [from, to, service, page]);

  useEffect(() => { void loadStats(); }, [loadStats]);
  useEffect(() => { void loadLogs(); }, [loadLogs]);

  return (
    <main className="app">
      <h1>SLA Monitoring Dashboard</h1>
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
      <StatsPanel stats={stats} loading={statsLoading} />
      <LogsTable
        logs={logs}
        loading={logsLoading}
        from={from}
        to={to}
        service={service}
        onFromChange={(v) => { setFrom(v); setPage(1); }}
        onToChange={(v) => { setTo(v); setPage(1); }}
        onServiceChange={(v) => { setService(v); setPage(1); }}
        onPageChange={setPage}
      />
    </main>
  );
}
