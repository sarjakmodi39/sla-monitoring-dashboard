import { withClient } from '../shared/db';
import { toRangeBounds } from '../shared/dateRange';

export interface LogRow {
  id: number;
  service_id: string;
  service_name: string;
  ts: string;
  status_code: number;
  latency_ms: number | null;
  agent: string;
  region: string;
  data_quality_flag: string | null;
}

export async function getLogs(params: {
  from?: string;
  to?: string;
  service?: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: LogRow[]; total: number; page: number; page_size: number }> {
  const { start, end } = toRangeBounds(params.from, params.to);
  const conditions = ['ts >= $1', 'ts < $2'];
  const values: unknown[] = [start, end];

  if (params.service) {
    values.push(params.service);
    conditions.push(`service_id = $${values.length}`);
  }

  const where = `where ${conditions.join(' and ')}`;
  const offset = (params.page - 1) * params.pageSize;

  const dataValues = [...values, params.pageSize, offset];
  const dataSql = `
    select id, service_id, service_name, ts, status_code, latency_ms, agent, region, data_quality_flag
    from checks
    ${where}
    order by ts desc
    limit $${dataValues.length - 1} offset $${dataValues.length}
  `;

  return withClient(async (client) => {
    const dataResult = await client.query(dataSql, dataValues);
    const countResult = await client.query(`select count(*) from checks ${where}`, values);

    return {
      rows: dataResult.rows,
      total: Number(countResult.rows[0].count),
      page: params.page,
      page_size: params.pageSize,
    };
  });
}
