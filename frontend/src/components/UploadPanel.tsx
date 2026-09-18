import { useState } from 'react';
import { uploadCsv, type UploadResponse, type UploadStage } from '../api';

type Status = 'idle' | UploadStage | 'done' | 'error';

const STATUS_TEXT: Record<Status, string> = {
  idle: 'Upload health-check CSV',
  uploading: 'Uploading…',
  processing: 'Processing…',
  done: 'Done',
  error: 'Upload health-check CSV',
};

export default function UploadPanel({ onUploaded }: { onUploaded: (summary: UploadResponse) => void }) {
  const [status, setStatus] = useState<Status>('idle');
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = status === 'uploading' || status === 'processing';

  async function handleFile(file: File) {
    setStatus('uploading');
    setFileName(file.name);
    setError(null);
    try {
      const summary = await uploadCsv(file, (stage) => setStatus(stage));
      setStatus('done');
      onUploaded(summary);
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  }

  return (
    <section className="upload-panel">
      <label htmlFor="csv-upload" className={`dropzone${busy ? ' dropzone-busy' : ''}`}>
        <span className={`dropzone-icon${busy ? ' dropzone-icon-spin' : ''}`} aria-hidden="true">
          {status === 'done' ? '✓' : '↑'}
        </span>
        <span className="dropzone-text">
          <strong>{STATUS_TEXT[status]}</strong>
          <span className="dropzone-hint">
            {busy && fileName ? fileName : 'Click to choose a file, or drag it here'}
          </span>
        </span>
        <input
          id="csv-upload"
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </label>
      {busy && (
        <div className="progress-track" role="progressbar" aria-label={STATUS_TEXT[status]}>
          <div className={`progress-fill progress-${status}`} />
        </div>
      )}
      {status === 'error' && <p className="section-error" role="alert">Upload failed: {error}</p>}
    </section>
  );
}
