import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { getServiceStats } from './stats';
import { getLogs } from './logs';

function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const path = event.rawPath;
  const qs = event.queryStringParameters ?? {};

  try {
    if (path === '/stats') {
      const data = await getServiceStats(qs.from, qs.to);
      return json(200, data);
    }
    if (path === '/logs') {
      const data = await getLogs({
        from: qs.from,
        to: qs.to,
        service: qs.service,
        page: Number(qs.page ?? '1'),
        pageSize: Number(qs.page_size ?? '50'),
      });
      return json(200, data);
    }
    return json(404, { error: `Unknown route: ${path}` });
  } catch (err) {
    return json(400, { error: (err as Error).message });
  }
}
