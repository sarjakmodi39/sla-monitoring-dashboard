import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('../shared/db', () => ({
  getPool: () => ({ query: queryMock }),
}));

beforeEach(() => {
  queryMock.mockReset();
});

describe('getServiceStats', () => {
  it('merges the aggregate query and the incident-count query per service, and applies the 99.9% threshold', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{
          service_id: 'svc-auth', service_name: 'auth-api',
          total_checks: '999', up_checks: '990', down_checks: '9', check_failures: '1',
          avg_latency_ms: '150.5', p95_latency_ms: '300',
        }],
      })
      .mockResolvedValueOnce({
        rows: [{ service_id: 'svc-auth', incident_count: '2' }],
      });

    const { getServiceStats } = await import('./stats');
    const result = await getServiceStats('2025-05-01', '2025-05-02');

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(result.by_service).toHaveLength(1);
    expect(result.by_service[0]).toMatchObject({
      service_id: 'svc-auth',
      incident_count: 2,
      check_failures: 1,
      downtime_minutes: 135, // 9 down checks * 15 minutes
      breaches_slo: true, // 990/999 = 99.0% < 99.9%
    });
  });
});
