import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
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

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const csvText = event.isBase64Encoded && event.body
    ? Buffer.from(event.body, 'base64').toString('utf-8')
    : event.body ?? '';

  const result = await handleUpload(csvText);

  return {
    statusCode: result.statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(result.body),
  };
}
