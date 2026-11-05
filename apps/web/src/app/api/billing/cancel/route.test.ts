import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '@/lib/security';

const fixture = vi.hoisted(() => ({
  requireUser: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), retrieve: vi.fn(), update: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUser: fixture.requireUser }));
vi.mock('@/lib/db', () => ({ db: { subscription: { findUnique: fixture.findUnique, updateMany: fixture.updateMany } } }));
vi.mock('@/lib/billing', () => ({ stripeClient: () => ({ subscriptions: { retrieve: fixture.retrieve, update: fixture.update } }) }));
vi.mock('@/lib/security', async original => ({ ...await original<typeof import('@/lib/security')>(), rateLimit: vi.fn() }));
import { POST } from './route';

const expires = Math.floor(Date.now() / 1000) + 86400;
const remote = { id: 'sub_owned', customer: 'cus_owned', status: 'active', cancel_at_period_end: false, trial_end: null, items: { data: [{ current_period_end: expires }] } };
function request(body: unknown = { confirm: true }, origin = 'http://localhost:3000') {
  return new Request('http://localhost:3000/api/billing/cancel', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('APP_URL', 'http://localhost:3000');
  fixture.requireUser.mockResolvedValue({ id: 'owner' });
  fixture.findUnique.mockResolvedValue({ id: 'local_owned', stripeCustomerId: 'cus_owned', stripeSubscriptionId: 'sub_owned' });
  fixture.retrieve.mockResolvedValue(remote);
  fixture.update.mockResolvedValue({ ...remote, cancel_at_period_end: true });
  fixture.updateMany.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllEnvs());

describe('subscription cancellation', () => {
  it('stops renewal at Stripe and retains the paid period without revoking access', async () => {
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ cancelAtPeriodEnd: true, currentPeriodEnd: new Date(expires * 1000).toISOString() });
    expect(fixture.update).toHaveBeenCalledWith('sub_owned', { cancel_at_period_end: true });
    expect(fixture.findUnique).toHaveBeenCalledWith({ where: { userId: 'owner' } });
    expect(fixture.updateMany).toHaveBeenCalledWith({
      where: { id: 'local_owned', userId: 'owner', stripeSubscriptionId: 'sub_owned', stripeCustomerId: 'cus_owned' },
      data: { cancelAtPeriodEnd: true },
    });
  });
  it('requires an explicit confirmation and refuses a caller-supplied subscription ID', async () => {
    expect((await POST(request({ confirm: false }))).status).toBe(400);
    expect((await POST(request({ confirm: true, subscriptionId: 'sub_someone_else' }))).status).toBe(400);
    expect(fixture.retrieve).not.toHaveBeenCalled();
  });
  it('rejects unauthenticated and cross-origin requests before touching Stripe', async () => {
    expect((await POST(request({ confirm: true }, 'https://another-site.test'))).status).toBe(403);
    fixture.requireUser.mockRejectedValue(new HttpError(401, 'Connectez-vous.'));
    expect((await POST(request())).status).toBe(401);
    expect(fixture.retrieve).not.toHaveBeenCalled();
  });
  it('refuses to modify a Stripe subscription whose customer does not match', async () => {
    fixture.retrieve.mockResolvedValue({ ...remote, customer: 'cus_other' });
    expect((await POST(request())).status).toBe(409);
    expect(fixture.update).not.toHaveBeenCalled();
    expect(fixture.updateMany).not.toHaveBeenCalled();
  });
  it('does not repeat a cancellation already confirmed by Stripe', async () => {
    fixture.retrieve.mockResolvedValue({ ...remote, status: 'trialing', cancel_at_period_end: true, trial_end: expires });
    const result = await POST(request());
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ cancelAtPeriodEnd: true, trialEndsAt: new Date(expires * 1000).toISOString() });
    expect(fixture.update).not.toHaveBeenCalled();
  });
  it('does not claim success or update local data when Stripe fails', async () => {
    fixture.update.mockRejectedValue(new Error('Stripe unavailable'));
    expect((await POST(request())).status).toBe(503);
    expect(fixture.updateMany).not.toHaveBeenCalled();
  });
  it('handles a concurrent subscription replacement without modifying its local state', async () => {
    fixture.updateMany.mockResolvedValue({ count: 0 });
    expect((await POST(request())).status).toBe(409);
  });
  it('refuses an account without a linked Stripe subscription', async () => {
    fixture.findUnique.mockResolvedValue(null);
    expect((await POST(request())).status).toBe(409);
    expect(fixture.retrieve).not.toHaveBeenCalled();
  });
});
