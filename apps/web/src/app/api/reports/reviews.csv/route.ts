import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError, HttpError, rateLimit } from '@/lib/security';
import { hasAnnualBenefits } from '@trusteo/core/pricing';
import { parseReportOptions, reportRange, REPORT_EXPORT_LIMIT, REVIEW_CSV_HEADER, reviewCsvRow } from '@trusteo/core/reporting';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const now = new Date();
    if (!hasAnnualBenefits(user.subscription, now)) throw new HttpError(403, 'Les rapports CSV sont réservés aux abonnements annuels actifs. Votre export RGPD reste disponible dans les paramètres.');
    const { days, locationId } = parseReportOptions(new URL(request.url).searchParams);
    await rateLimit(`review-report:${user.id}`, 5, 3600);
    if (locationId && !await db.location.findFirst({ where: { id: locationId, userId: user.id }, select: { id: true } })) throw new HttpError(404, 'Établissement introuvable.');
    const { since, until } = reportRange(days, now);
    // Ownership is part of every review query, not inferred from a client ID.
    const where = { location: { userId: user.id }, ...(locationId ? { locationId } : {}), publishedAt: { gte: since, lte: until } };
    const total = await db.review.count({ where });
    if (total > REPORT_EXPORT_LIMIT) throw new HttpError(413, 'Le rapport dépasse 10 000 avis. Choisissez un établissement ou une période plus courte.');
    const encoder = new TextEncoder();
    let cursor: string | undefined;
    let emitted = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(encoder.encode('\ufeff' + REVIEW_CSV_HEADER)); },
      async pull(controller) {
        if (cancelled) return;
        if (emitted >= total) { controller.close(); return; }
        try {
          const rows = await db.review.findMany({
            where, orderBy: { id: 'asc' }, take: Math.min(500, total - emitted),
            ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
            select: { id: true, platform: true, author: true, rating: true, text: true, language: true,
              publishedAt: true, status: true, repliedAt: true, replyText: true, sourceUrl: true,
              location: { select: { name: true } } },
          });
          if (cancelled) return;
          if (!rows.length) { controller.close(); return; }
          cursor = rows.at(-1)!.id;
          emitted += rows.length;
          controller.enqueue(encoder.encode(rows.map(reviewCsvRow).join('')));
          if (emitted >= total) controller.close();
        } catch (error) { if (!cancelled) controller.error(error); }
      },
      cancel() { cancelled = true; },
    });
    return new Response(stream, { headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="trusteo-reviews-${now.toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return apiError(error); }
}
