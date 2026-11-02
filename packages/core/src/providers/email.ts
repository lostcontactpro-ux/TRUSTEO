import { createHash } from 'node:crypto';
import { z } from 'zod';
import { normalizedReviewSchema, ProviderError, type NormalizedReview, type PlatformId } from './types';

export const notificationEmailSchema = z.object({
  messageId: z.string().min(1).max(1000),
  subject: z.string().max(2000),
  text: z.string().min(1).max(100000),
  receivedAt: z.coerce.date(),
});
export type NotificationEmail = z.infer<typeof notificationEmailSchema>;
const domains: Partial<Record<PlatformId, readonly string[]>> = {
  google: ['google.com', 'google.fr', 'g.page'], trustpilot: ['trustpilot.com'],
  facebook: ['facebook.com'], instagram: ['instagram.com'], tripadvisor: ['tripadvisor.com', 'tripadvisor.fr'],
  thefork: ['thefork.com', 'thefork.fr', 'lafourchette.com'], yelp: ['yelp.com', 'yelp.fr'],
  pagesjaunes: ['pagesjaunes.fr'], apple: ['apple.com'], foursquare: ['foursquare.com'],
  skeepers: ['avis-verifies.com', 'skeepers.io'], booking: ['booking.com'], airbnb: ['airbnb.com', 'airbnb.fr'],
  expedia: ['expedia.com', 'expedia.fr', 'hotels.com'], ubereats: ['ubereats.com'], deliveroo: ['deliveroo.com', 'deliveroo.fr'],
  justeat: ['just-eat.fr', 'just-eat.com'], 'google-shopping': ['google.com', 'google.fr'],
  appstore: ['apps.apple.com'], googleplay: ['play.google.com'], capterra: ['capterra.com', 'capterra.fr'], g2: ['g2.com'],
};
export function isProviderUrl(platform: string, value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (platform === 'custom') return true; // Display-only URL; never fetched by the server.
    return (domains[platform as PlatformId] ?? []).some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
  } catch { return false; }
}
/**
 * Conservative plain-text FR/EN parser. Authenticate the email gateway signature,
 * route the private alias to its tenant, and reject gateway replays BEFORE calling.
 * Unsupported notification formats fail for manual verification, never invented data.
 * Accepted fields: Author/Auteur, Rating/Note (x/5 or x/10), Date (ISO), Review/Avis, URL.
 */
export function parseNotificationEmail(platform: PlatformId, locationId: string, raw: unknown): NormalizedReview {
  const email = notificationEmailSchema.parse(raw);
  const sourceUrl = (email.text.match(/https:\/\/[^\s<>"']+/g) ?? [])
    .map(value => value.replace(/[).,;]+$/, ''))
    .find(value => isProviderUrl(platform, value));
  const author = email.text.match(/^(?:Author|Auteur|Reviewer|Client)\s*:\s*(.+)$/im)?.[1]?.trim();
  const score = email.text.match(/^(?:Rating|Note|Score)\s*:\s*(\d(?:[.,]\d+)?)\s*\/\s*(5|10)\b/im);
  const dateValue = email.text.match(/^Date\s*:\s*(\d{4}-\d{2}-\d{2}(?:T[^\s]+)?)\s*$/im)?.[1];
  const body = email.text.match(/^(?:Review|Avis|Commentaire)\s*:\s*([\s\S]+?)(?=\n(?:URL|Lien|Date|Rating|Note|Score|Author|Auteur)\s*:|$)/im)?.[1]?.trim();
  if (!sourceUrl || !author || !score || !dateValue || !body) {
    throw new ProviderError('Notification format not recognized. Verify and import the original review fields manually.', 'validation');
  }
  const url = new URL(sourceUrl);
  const explicitId = email.text.match(/^(?:Review ID|Identifiant avis)\s*:\s*([^\s]+)\s*$/im)?.[1]
    ?? url.searchParams.get('reviewId')
    ?? (url.pathname.match(/\/reviews\/([^/]+)\/?$/)?.[1]);
  const externalId = explicitId ?? `email:${createHash('sha256').update(`${platform}\n${sourceUrl}\n${author}\n${dateValue}`).digest('hex')}`;
  return normalizedReviewSchema.parse({
    externalId, platform, locationId, author,
    rating: Number(score[1].replace(',', '.')) * 5 / Number(score[2]),
    text: body, language: /^(?:Auteur|Note|Avis)\s*:/im.test(email.text) ? 'fr' : 'en',
    publishedAt: dateValue, responseStatus: 'pending', sourceUrl,
  });
}
