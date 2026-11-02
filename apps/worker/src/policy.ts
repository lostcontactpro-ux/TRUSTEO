import { ProviderError, type NormalizedReview } from '@trusteo/core/providers/index';

/** Provider responses cannot change tenant association supplied by our DB. */
export function reviewFields(review: NormalizedReview) {
  return {
    externalId: review.externalId, platform: review.platform, author: review.author,
    rating: review.rating, text: review.text, language: review.language,
    publishedAt: review.publishedAt, sourceUrl: review.sourceUrl,
  };
}
export function reviewNotification(rating: number, business: string) {
  return {
    title: rating < 3.3 ? 'Avis prioritaire à traiter' : 'Nouvel avis reçu',
    body: `${business} : un avis ${rating}/5 attend votre attention.`,
  };
}
export function safeFailure(error: unknown): string {
  if (error instanceof ProviderError) return `provider:${error.code}${error.statusCode ? `:${error.statusCode}` : ''}`;
  return 'operation_failed';
}
export function safePushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443') && (
      url.hostname === 'fcm.googleapis.com' || url.hostname === 'web.push.apple.com' ||
      url.hostname.endsWith('.push.services.mozilla.com') || url.hostname.endsWith('.notify.windows.com')
    );
  } catch { return false; }
}
export function insideIdempotencyWindow(startedAt: Date, now = new Date()): boolean {
  // Resend retains idempotency keys for 24 hours. Stop before expiry rather than
  // silently issuing a second message after an extended worker outage.
  return now.getTime() - startedAt.getTime() < 23 * 60 * 60 * 1000;
}
export function escapedHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}
