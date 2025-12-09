import { format, addDays, differenceInDays, parseISO } from 'date-fns';

export interface DateRange {
  from: string;
  to: string;
}

/**
 * Split a date range into chunks of maximum 90 days (Dhan API limit)
 */
export function chunkDateRange(fromDate: string, toDate: string): DateRange[] {
  const chunks: DateRange[] = [];
  const start = parseISO(fromDate);
  const end = parseISO(toDate);

  const totalDays = differenceInDays(end, start);

  if (totalDays <= 90) {
    return [{ from: fromDate, to: toDate }];
  }

  let currentStart = start;

  while (currentStart < end) {
    const currentEnd = addDays(currentStart, 89); // 90 days inclusive
    const chunkEnd = currentEnd > end ? end : currentEnd;

    chunks.push({
      from: format(currentStart, 'yyyy-MM-dd'),
      to: format(chunkEnd, 'yyyy-MM-dd'),
    });

    currentStart = addDays(chunkEnd, 1);
  }

  return chunks;
}

/**
 * Format timestamp to ISO date string
 */
export function formatTimestamp(timestamp: number): string {
  return format(new Date(timestamp * 1000), 'yyyy-MM-dd HH:mm:ss');
}
