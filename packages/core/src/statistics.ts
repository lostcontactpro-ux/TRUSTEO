import { reportRange, type ReportWindow } from './reporting';
export type StatisticReview = { rating: number; publishedAt: Date; repliedAt: Date | null; locationId: string; status?: string };

export function summarizeReviews(reviews: StatisticReview[], now = new Date(), windowDays: ReportWindow = 30) {
  const { since, previousSince } = reportRange(windowDays, now);
  // Lifetime metrics remain available to everyone; only the trend window expands
  // for annual subscriptions. Do not silently discard older monthly-account data.
  const existing = reviews.filter(review => review.publishedAt <= now);
  const recent = existing.filter(review => review.publishedAt >= since);
  const before = existing.filter(review => review.publishedAt >= previousSince && review.publishedAt < since);
  const avg = (rows: StatisticReview[]) => rows.length ? rows.reduce((sum, review) => sum + review.rating, 0) / rows.length : null;
  const answered = existing.filter(review => review.repliedAt && review.repliedAt >= review.publishedAt && review.repliedAt <= now);
  const buckets = new Map<string, { total: number; count: number }>();
  for (const review of recent) {
    const date = review.publishedAt.toISOString().slice(0, 10);
    const bucket = buckets.get(date) ?? { total: 0, count: 0 };
    bucket.total += review.rating;
    bucket.count++;
    buckets.set(date, bucket);
  }
  return {
    windowDays,
    averageRating: avg(existing),
    reviewCount: existing.length,
    pendingCount: existing.filter(review => !review.repliedAt && review.status !== 'replied').length,
    averageResponseHours: answered.length ? answered.reduce((sum, review) => sum + (review.repliedAt!.getTime() - review.publishedAt.getTime()) / 3_600_000, 0) / answered.length : null,
    ratingChange: recent.length && before.length ? avg(recent)! - avg(before)! : null,
    series: Array.from({ length: windowDays }, (_, index) => {
      const date = new Date(since.getTime() + index * 86_400_000).toISOString().slice(0, 10);
      const bucket = buckets.get(date);
      return { date, rating: bucket ? bucket.total / bucket.count : null, count: bucket?.count ?? 0 };
    }),
  };
}
