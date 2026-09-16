import { describe, it, expect } from 'vitest';
import { toRangeBounds } from './dateRange';

describe('toRangeBounds', () => {
  it('expands a single date to a full UTC day', () => {
    const { start, end } = toRangeBounds('2025-05-13', '2025-05-13');
    expect(start).toBe('2025-05-13T00:00:00.000Z');
    expect(end).toBe('2025-05-14T00:00:00.000Z');
  });

  it('spans from the start of "from" to the end of "to"', () => {
    const { start, end } = toRangeBounds('2025-05-01', '2025-05-03');
    expect(start).toBe('2025-05-01T00:00:00.000Z');
    expect(end).toBe('2025-05-04T00:00:00.000Z');
  });

  it('defaults to an open range when both are omitted', () => {
    const { start, end } = toRangeBounds();
    expect(start).toBe('1970-01-01T00:00:00.000Z');
    expect(new Date(end).getTime()).toBeGreaterThan(Date.now());
  });
});
