import { describe, expect, it } from 'vitest';
import { insideIdempotencyWindow, reviewFields, reviewNotification, safeFailure, safePushEndpoint } from './policy';
import { ProviderError, type NormalizedReview } from '@trusteo/core/providers/index';
describe('worker trust boundaries', () => {
  it('prioritizes ratings strictly below 3.3 without generating any customer reviews', () => {
    expect(reviewNotification(3.2, 'Le Bistrot').title).toBe('Avis prioritaire à traiter');
    expect(reviewNotification(3.3, 'Le Bistrot').title).toBe('Nouvel avis reçu');
  });
  it.each(['https://fcm.googleapis.com/fcm/send/123','https://updates.push.services.mozilla.com/wpush/123','https://web.push.apple.com/123'])('accepts a supported push endpoint %s', (url) => expect(safePushEndpoint(url)).toBe(true));
  it.each(['http://fcm.googleapis.com/push','https://localhost/x','https://169.254.169.254/metadata','https://evil.test.push.services.mozilla.com.evil.test/x','https://fcm.googleapis.com:444/push','https://user:secret@fcm.googleapis.com/push'])('blocks SSRF or foreign endpoint %s', (url) => expect(safePushEndpoint(url)).toBe(false));
  it('rejects retries beyond the Resend idempotency window', () => {
    const now = new Date('2026-11-02T12:00:00Z');
    expect(insideIdempotencyWindow(new Date('2026-11-01T14:00:00Z'), now)).toBe(true);
    expect(insideIdempotencyWindow(new Date('2026-11-01T12:00:00Z'), now)).toBe(false);
  });
  it('keeps credentials and upstream customer text out of sync errors', () => {
    expect(safeFailure(new Error('secret-token customer email'))).toBe('operation_failed');
    expect(safeFailure(new ProviderError('raw upstream body', 'authorization', false, undefined, 401))).toBe('provider:authorization:401');
  });
  it('does not accept tenant IDs or local replies from normalized provider fields', () => {
    const review = { externalId: 'r1', platform: 'google', locationId: 'malicious-other-tenant', author: 'Client', rating: 4, text: 'Merci', language: 'fr', publishedAt: new Date(), responseStatus: 'pending', sourceUrl: 'https://business.google.com', reply: 'upstream reply' } satisfies NormalizedReview;
    const fields = reviewFields(review); expect(fields).not.toHaveProperty('locationId'); expect(fields).not.toHaveProperty('replyText');
  });
});
