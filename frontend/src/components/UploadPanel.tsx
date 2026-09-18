import { useState } from 'react';
import { uploadCsv, type UploadResponse } from '../api';

export default function UploadPanel({ onUploaded }: { onUploaded: (summary: UploadResponse) => void }) {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus('uploading');
    setError(null);
    try {
      const summary = await uploadCsv(file);
      setStatus('idle');
      onUploaded(summary);
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  }

  return (
    <section className="upload-panel">
      <label htmlFor="csv-upload" className={`dropzone${status === 'uploading' ? ' dropzone-busy' : ''}`}>
        <span className="dropzone-icon" aria-hidden="true">↑</span>
        <span className="dropzone-text">
          <strong>{status === 'uploading' ? 'Uploading…' : 'Upload health-check CSV'}</strong>
          <span className="dropzone-hint">Click to choose a file, or drag it here</span>
        </span>
        <input
          id="csv-upload"
          type="file"
          accept=".csv,text/csv"
          disabled={status === 'uploading'}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
      </label>
      {status === 'error' && <p className="section-error" role="alert">Upload failed: {error}</p>}
    </section>
  );
}
