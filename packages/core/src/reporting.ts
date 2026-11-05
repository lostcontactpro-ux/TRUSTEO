import { z } from 'zod';

export const REPORT_WINDOWS = [30, 90, 365] as const;
export type ReportWindow = typeof REPORT_WINDOWS[number];
export const REPORT_EXPORT_LIMIT = 10_000;

export function parseReportOptions(params: URLSearchParams): { days: ReportWindow; locationId?: string } {
  const options = z.object({
    days: z.enum(['30', '90', '365']).default('30'),
    locationId: z.string().trim().min(1).max(100).optional(),
  }).parse({ days: params.get('days') ?? undefined, locationId: params.get('locationId') || undefined });
  return { days: Number(options.days) as ReportWindow, ...(options.locationId ? { locationId: options.locationId } : {}) };
}

/** Whole UTC calendar days, including the current partial day; future reviews
 * are excluded. Calendar boundaries stay stable across daylight-saving changes. */
export function reportRange(days: ReportWindow, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const since = new Date(today - (days - 1) * 86_400_000);
  return { since, until: now, previousSince: new Date(since.getTime() - days * 86_400_000) };
}

export type ChartPoint = { date: string; rating: number | null; count: number };
export function groupReportSeries(series: ChartPoint[], days: ReportWindow): ChartPoint[] {
  if (days === 30) return series;
  const groups = new Map<string, { count: number; ratingTotal: number }>();
  for (let index = 0; index < series.length; index++) {
    const point = series[index];
    const key = days === 365 ? point.date.slice(0, 7) : series[Math.floor(index / 7) * 7].date;
    const group = groups.get(key) ?? { count: 0, ratingTotal: 0 };
    group.count += point.count;
    group.ratingTotal += (point.rating ?? 0) * point.count;
    groups.set(key, group);
  }
  return [...groups].map(([date, { count, ratingTotal }]) => ({ date, count, rating: count ? ratingTotal / count : null }));
}

export type CsvReview = {
  id: string;
  platform: string;
  author: string;
  rating: number;
  text: string;
  language: string;
  publishedAt: Date;
  status: string;
  repliedAt: Date | null;
  replyText: string | null;
  sourceUrl: string | null;
  location: { name: string };
};

/** Quotes alone do not prevent spreadsheet formula execution. Prefix dangerous
 * values with an apostrophe before RFC4180 escaping, including hidden controls. */
export function csvCell(value: string | number | null): string {
  let text = value === null ? '' : String(value);
  text = text.replace(/\u0000/g, '');
  if (/^[\u0001-\u0020\ufeff]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export const REVIEW_CSV_HEADER = [
  'location', 'platform', 'review_id', 'author', 'rating_out_of_5', 'text', 'language',
  'published_at_utc', 'reply_status', 'replied_at_utc', 'reply_text', 'source_url',
].map(csvCell).join(',') + '\r\n';
export function reviewCsvRow(review: CsvReview): string {
  return [review.location.name, review.platform, review.id, review.author, review.rating,
    review.text, review.language, review.publishedAt.toISOString(), review.status,
    review.repliedAt?.toISOString() ?? null, review.replyText, review.sourceUrl,
  ].map(csvCell).join(',') + '\r\n';
}
