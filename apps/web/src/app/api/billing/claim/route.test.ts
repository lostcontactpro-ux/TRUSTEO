import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ user: vi.fn(), claim: vi.fn(), resend: vi.fn(), limit: vi.fn(), stripe: {} }));
vi.mock('@/lib/auth', () => ({ requireUser: f.user }));
vi.mock('@/lib/billing', () => ({ stripeClient: () => f.stripe }));
vi.mock('@/lib/payment-receipts', () => ({ claimPaymentReceipt: f.claim, resendPaymentReceipts: f.resend }));
vi.mock('@/lib/security', async original => ({ ...await original<typeof import('@/lib/security')>(), rateLimit: f.limit }));
import { HttpError } from '@/lib/security';
import { POST } from './route';
import { POST as RESEND } from './resend/route';
const request = (body: unknown, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/billing/claim', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.stubEnv('APP_URL', 'http://localhost:3000'); f.user.mockReset(); f.claim.mockReset(); f.resend.mockReset(); f.limit.mockReset();
  f.user.mockResolvedValue({ id: 'authenticated_owner', email: 'Owner@Example.test' }); f.limit.mockResolvedValue(undefined);
  f.claim.mockResolvedValue({ claimed: true, plan: 'essential', interval: 'year', status: 'active' }); f.resend.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
describe('payment receipt HTTP routes', () => {
  it('claims using the authenticated owner only, with no browser-selected user or customer', async () => {
    expect((await POST(request({ token: 'a'.repeat(64) }))).status).toBe(200);
    expect(f.claim).toHaveBeenCalledWith(f.stripe, 'authenticated_owner', 'a'.repeat(64));
    expect((await POST(request({ token: 'a'.repeat(64), userId: 'attacker' }))).status).toBe(400);
    expect(f.claim).toHaveBeenCalledTimes(1);
  });
  it('rejects missing authentication, malformed proof and cross-site mutation', async () => {
    expect((await POST(request({ token: 'bad' }))).status).toBe(400);
    expect((await POST(request({ token: 'a'.repeat(64) }, 'https://untrusted.example.test'))).status).toBe(403);
    f.user.mockRejectedValueOnce(new HttpError(401, 'Connectez-vous.'));
    expect((await POST(request({ token: 'a'.repeat(64) }))).status).toBe(401);
    expect(f.claim).not.toHaveBeenCalled();
  });
  it('propagates proof/email failures without silently activating a contract', async () => {
    f.claim.mockRejectedValue(new HttpError(403, 'Connectez-vous avec l’adresse du paiement.'));
    expect((await POST(request({ token: 'a'.repeat(64) }))).status).toBe(403);
  });
  it('resends only to the authenticated email and returns a generic response without identifiers', async () => {
    const response = await RESEND(request({})); expect(response.status).toBe(200);
    expect(f.resend).toHaveBeenCalledWith(f.stripe, 'Owner@Example.test');
    const body = await response.json(); expect(Object.keys(body)).toEqual(['message']); expect(JSON.stringify(body)).not.toContain('Example.test');
    expect(f.limit).toHaveBeenCalledWith('payment-claim-resend:global', 1000, 3600);
    expect(f.limit).toHaveBeenCalledWith('payment-claim-resend:user:authenticated_owner', 3, 3600);
    expect(f.limit).toHaveBeenCalledWith('payment-claim-resend:email:owner@example.test', 3, 3600);
    expect((await RESEND(request({ email: 'someone-else@example.test' }))).status).toBe(400);
    expect(f.resend).toHaveBeenCalledTimes(1);
  });
});
