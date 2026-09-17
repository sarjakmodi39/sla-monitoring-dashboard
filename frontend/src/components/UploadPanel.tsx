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
      <label htmlFor="csv-upload">Upload health-check CSV</label>
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
      {status === 'uploading' && <p>Uploading and processing...</p>}
      {status === 'error' && <p role="alert">Upload failed: {error}</p>}
    </section>
  );
}
