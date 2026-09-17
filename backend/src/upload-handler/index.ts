import { cleanBatch } from './clean';
import { insertCleanedRows } from '../shared/db';

export async function handleUpload(
  csvText: string,
  insert: typeof insertCleanedRows = insertCleanedRows,
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  if (!csvText || csvText.trim().length === 0) {
    return { statusCode: 400, body: { error: 'Empty upload body' } };
  }

  let result;
  try {
    result = cleanBatch(csvText);
  } catch (err) {
    return { statusCode: 400, body: { error: (err as Error).message } };
  }

  const { inserted, duplicates } = await insert(result.rows);

  return {
    statusCode: 200,
    body: {
      rows_received: result.rows_received,
      rows_inserted: inserted,
      rows_duplicate: duplicates,
      rows_skipped: result.rows_skipped,
      flags_summary: result.flags_summary,
    },
  };
}
