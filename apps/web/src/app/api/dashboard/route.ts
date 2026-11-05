import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { apiError, HttpError } from '@/lib/security';
import { summarizeReviews } from '@trusteo/core/statistics';
import { parseReportOptions } from '@trusteo/core/reporting';
import { hasAnnualBenefits } from '@trusteo/core/pricing';

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const now = new Date();
    const { days, locationId } = parseReportOptions(new URL(request.url).searchParams);
    const annualBenefits = hasAnnualBenefits(user.subscription, now);
    if (days !== 30 && !annualBenefits) throw new HttpError(403, 'L’historique 90 et 365 jours est réservé aux abonnements annuels actifs.');
    const locations = await db.location.findMany({
      where: { userId: user.id, ...(locationId ? { id: locationId } : {}) },
      include: { reviews: { select: { rating: true, publishedAt: true, repliedAt: true, locationId: true, status: true } } },
    });
    if (locationId && !locations.length) throw new HttpError(404, 'Établissement introuvable.');
    const reviews = locations.flatMap(location => location.reviews);
    const recentReviews = await db.review.findMany({
      where: { location: { userId: user.id }, ...(locationId ? { locationId } : {}), publishedAt: { lte: now } },
      orderBy: { publishedAt: 'desc' }, take: 5, include: { location: { select: { name: true } } },
    });
    return Response.json({
      ...summarizeReviews(reviews, now, days), annualBenefits,
      locations: locations.map(location => ({ id: location.id, name: location.name, ...summarizeReviews(location.reviews, now, days) })),
      recentReviews,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
