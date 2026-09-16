const DAY_MS = 24 * 60 * 60 * 1000;

export function toRangeBounds(from?: string, to?: string): { start: string; end: string } {
  const start = from ? new Date(`${from}T00:00:00Z`).toISOString() : new Date(0).toISOString();
  const endDate = to ?? from;
  const end = endDate
    ? new Date(new Date(`${endDate}T00:00:00Z`).getTime() + DAY_MS).toISOString()
    : new Date(Date.now() + DAY_MS).toISOString();
  return { start, end };
}
