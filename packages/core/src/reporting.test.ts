import { describe, it, expect } from 'vitest';
import { csvCell, groupReportSeries, parseReportOptions, reportRange, reviewCsvRow } from './reporting';
import { summarizeReviews } from './statistics';

describe('annual report windows', () => {
  it('accepts only advertised windows and uses full UTC calendar days', () => {
    expect(parseReportOptions(new URLSearchParams())).toEqual({ days: 30 });
    expect(parseReportOptions(new URLSearchParams('days=365&locationId=mine'))).toEqual({ days: 365, locationId: 'mine' });
    expect(() => parseReportOptions(new URLSearchParams('days=999999'))).toThrow();
    const range = reportRange(30, new Date('2026-11-05T12:00:00Z'));
    expect(range.since.toISOString()).toBe('2026-10-07T00:00:00.000Z');
    expect(range.previousSince.toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });
  it('extends trends without hiding old monthly-account data or including future reviews', () => {
    const now = new Date('2026-11-05T12:00:00Z');
    const review = (date: string, rating = 4) => ({ publishedAt: new Date(date), rating, repliedAt: null, locationId: 'mine' });
    const reviews = [review('2026-10-07T00:00:00Z'), review('2026-08-20T00:00:00Z'), review('2024-01-01T00:00:00Z'), review('2026-11-06T00:00:00Z')];
    expect(summarizeReviews(reviews, now, 30).reviewCount).toBe(3);
    expect(summarizeReviews(reviews, now, 30).series.reduce((sum, point) => sum + point.count, 0)).toBe(1);
    expect(summarizeReviews(reviews, now, 90).series.reduce((sum, point) => sum + point.count, 0)).toBe(2);
    expect(summarizeReviews(reviews, now, 365).series).toHaveLength(365);
  });
  it('keeps the entire 90/365-day total when grouping charts for narrow screens', () => {
    for (const days of [90, 365] as const) {
      const since = reportRange(days, new Date('2026-11-05')).since;
      const series = Array.from({ length: days }, (_, index) => ({ date: new Date(since.getTime() + index * 86_400_000).toISOString().slice(0, 10), count: 1, rating: index % 2 ? 3 : 5 }));
      const grouped = groupReportSeries(series, days);
      expect(grouped.length).toBeLessThanOrEqual(14);
      expect(grouped.reduce((sum, point) => sum + point.count, 0)).toBe(days);
    }
  });
});

describe('spreadsheet-safe review exports', () => {
  it.each(['=HYPERLINK("https://evil.example")', '+cmd', '-1+2', '@SUM(A1)', '  =1+2', '\t=1+2', '\ufeff=1+2'])('neutralises untrusted formula %j', value => {
    expect(csvCell(value).startsWith('"\'')).toBe(true);
  });
  it('escapes quotes/newlines and preserves real review text instead of losing columns', () => {
    const row = reviewCsvRow({ id: 'a', platform: 'google', author: '=1+2', rating: 2.5, text: 'A "quoted", review\ncontinued', language: 'fr', publishedAt: new Date('2026-11-05T00:00:00Z'), status: 'pending', repliedAt: null, replyText: null, sourceUrl: 'https://example.fr/avis', location: { name: 'Mon Café' } });
    expect(row).toContain('"\'=1+2"');
    expect(row).toContain('"A ""quoted"", review\ncontinued"');
    expect(row).toContain('"2.5"');
    expect(row.endsWith('\r\n')).toBe(true);
  });
});
