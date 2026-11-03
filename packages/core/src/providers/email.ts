import { createHash } from 'node:crypto';
import { z } from 'zod';
import { providerDefinitions } from './registry.generated';
import { normalizedReviewSchema, isSafeSourceUrl, ProviderError, type NormalizedReview, type PlatformId } from './types';

export const notificationEmailSchema = z.object({
  messageId: z.string().min(1).max(1000),
  subject: z.string().max(2000),
  text: z.string().min(1).max(100000),
  receivedAt: z.coerce.date(),
});
export type NotificationEmail = z.infer<typeof notificationEmailSchema>;
export function isProviderUrl(platform: string, value: string): boolean {
  try {
    if(!isSafeSourceUrl(value))return false;
    const url = new URL(value);
    if (platform === 'custom') return true; // Display-only URL; never fetched by the server.
    return (providerDefinitions.find(definition=>definition.id===platform)?.allowedReviewHosts ?? []).some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
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
  const text=email.text.replace(/\r\n/g,'\n');
  const bodyStart=/^(?:Review|Avis|Commentaire)\s*:[ \t]*/im.exec(text);
  if(!bodyStart)throw new ProviderError('Notification format not recognized. Verify and import the original review fields manually.', 'validation');
  // Metadata is never read from the review text: customers can write arbitrary lines.
  const metadata=text.slice(0,bodyStart.index);
  let body=text.slice(bodyStart.index+bodyStart[0].length).trim();
  const footer=/\n(?:URL|Lien)\s*:[ \t]*(https:\/\/[^\s<>"']+)[ \t]*$/i.exec(body);
  const headerUrl=metadata.match(/^(?:URL|Lien)\s*:[ \t]*(https:\/\/[^\s<>"']+)[ \t]*$/im)?.[1];
  const sourceUrl=headerUrl??footer?.[1];
  if(footer)body=body.slice(0,footer.index).trim();
  const author=metadata.match(/^(?:Author|Auteur|Reviewer|Client)\s*:[ \t]*(.+)$/im)?.[1]?.trim();
  const score=metadata.match(/^(?:Rating|Note|Score)\s*:[ \t]*(\d{1,2}(?:[.,]\d+)?)\s*\/\s*(5|10)\b/im);
  const dateValue=metadata.match(/^Date\s*:[ \t]*(\d{4}-\d{2}-\d{2}(?:T[^\s]+)?)[ \t]*$/im)?.[1];
  if(!sourceUrl||!isProviderUrl(platform,sourceUrl)||!author||!score||!dateValue||!body||(headerUrl&&footer&&headerUrl!==footer[1])){
    throw new ProviderError('Notification format not recognized. Verify and import the original review fields manually.', 'validation');
  }
  const url=new URL(sourceUrl);
  const metadataId=metadata.match(/^(?:Review ID|Identifiant avis)\s*:[ \t]*([^\s]+)[ \t]*$/im)?.[1];
  const sourceId=url.searchParams.get('reviewId')??url.pathname.match(/\/reviews\/([^/]+)\/?$/)?.[1];
  if(metadataId&&sourceId&&metadataId!==sourceId)throw new ProviderError('Conflicting review identifiers; manual verification is required.','validation');
  const externalId=metadataId??sourceId??`email:${createHash('sha256').update(`${platform}\n${sourceUrl}\n${author}\n${dateValue}`).digest('hex')}`;
  return normalizedReviewSchema.parse({
    externalId, platform, locationId, author,
    rating: Number(score[1].replace(',', '.')) * 5 / Number(score[2]),
    text: body, language: /^(?:Auteur|Note|Avis)\s*:/im.test(email.text) ? 'fr' : 'en',
    publishedAt: dateValue, responseStatus: 'pending', sourceUrl,
  });
}
