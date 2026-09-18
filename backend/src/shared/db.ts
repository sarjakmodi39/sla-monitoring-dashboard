import { Client } from 'pg';
import type { CleanedCheckRow } from './types';

const BATCH_SIZE = 1000;

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function insertCleanedRows(
  rows: CleanedCheckRow[],
): Promise<{ inserted: number; duplicates: number }> {
  if (rows.length === 0) return { inserted: 0, duplicates: 0 };

  return withClient(async (client) => {
    let inserted = 0;

    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const values: unknown[] = [];
      const placeholders = batch
        .map((r, i) => {
          const base = i * 9;
          values.push(
            r.service_id, r.service_name, r.ts, r.status_code,
            r.latency_ms, r.agent, r.region, r.data_quality_flag, r.raw_line,
          );
          return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9})`;
        })
        .join(',');

      const sql = `
        insert into checks (service_id, service_name, ts, status_code, latency_ms, agent, region, data_quality_flag, raw_line)
        values ${placeholders}
        on conflict (service_id, ts, agent) do nothing
        returning id
      `;

      const result = await client.query(sql, values);
      inserted += result.rowCount ?? 0;
    }

    return { inserted, duplicates: rows.length - inserted };
  });
}
