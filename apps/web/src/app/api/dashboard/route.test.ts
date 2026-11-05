import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), locationFindMany: vi.fn(), reviewFindMany: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db', () => ({ db: { location: { findMany: mocks.locationFindMany }, review: { findMany: mocks.reviewFindMany } } }));
import { HttpError } from '@/lib/security';
import { GET } from './route';

const now = new Date('2026-11-05T12:00:00Z');
const annual = { plan: 'essential', status: 'active', interval: 'year', currentPeriodEnd: new Date('2027-11-05T00:00:00Z') };
const monthly = { ...annual, interval: 'month' };
const ownerId = 'merchant-one';
const locations = [
  { id: 'location-one', userId: ownerId, name: 'Owned location', reviews: [{ rating: 5, publishedAt: new Date('2026-11-01T12:00:00Z'), repliedAt: null, locationId: 'location-one', status: 'pending' }] },
  { id: 'location-two', userId: 'merchant-two', name: 'FOREIGN LOCATION', reviews: [{ rating: 1, publishedAt: new Date('2026-11-01T12:00:00Z'), repliedAt: null, locationId: 'location-two', status: 'pending' }] },
];
function request(query = '') { return new Request(`http://localhost:3000/api/dashboard${query}`); }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: ownerId, subscription: monthly });
  mocks.locationFindMany.mockImplementation(async ({ where }: { where: { userId?: string; id?: string } }) => locations.filter(location => (!where.userId || location.userId === where.userId) && (!where.id || location.id === where.id)));
  mocks.reviewFindMany.mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

describe('dashboard history entitlement', () => {
  it.each([['monthly', monthly], ['inactive', { ...monthly, status: 'canceled' }], ['without subscription', null]])('keeps 30-day and cumulative base data available for %s accounts', async (_label, subscription) => {
    mocks.requireUser.mockResolvedValueOnce({ id: ownerId, subscription });
    const response = await GET(request('?days=30'));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ windowDays: 30, annualBenefits: false, averageRating: 5, reviewCount: 1 });
    expect(result.series).toHaveLength(30);
    expect(JSON.stringify(result)).not.toContain('FOREIGN LOCATION');
  });

  it.each([90, 365])('denies %s-day history to monthly users before reading reviews', async days => {
    const response = await GET(request(`?days=${days}`));
    expect(response.status).toBe(403);
    expect(mocks.locationFindMany).not.toHaveBeenCalled();
    expect(mocks.reviewFindMany).not.toHaveBeenCalled();
  });

  it.each([90, 365])('allows %s-day history for a paid annual subscription', async days => {
    mocks.requireUser.mockResolvedValueOnce({ id: ownerId, subscription: annual });
    const response = await GET(request(`?days=${days}`));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({ windowDays: days, annualBenefits: true, reviewCount: 1 });
    expect(result.series).toHaveLength(days);
  });

  it('does not extend annual access past its paid-through date', async () => {
    mocks.requireUser.mockResolvedValueOnce({ id: ownerId, subscription: { ...annual, currentPeriodEnd: new Date('2026-11-05T11:59:59Z') } });
    expect((await GET(request('?days=365'))).status).toBe(403);
    expect(mocks.locationFindMany).not.toHaveBeenCalled();
  });
});

describe('dashboard account boundary and validation', () => {
  it('requires a session before querying account data', async () => {
    mocks.requireUser.mockRejectedValueOnce(new HttpError(401, 'Connexion requise.'));
    expect((await GET(request())).status).toBe(401);
    expect(mocks.locationFindMany).not.toHaveBeenCalled();
  });

  it('returns 404 for a location belonging to another account', async () => {
    const response = await GET(request('?locationId=location-two'));
    expect(response.status).toBe(404);
    expect(mocks.reviewFindMany).not.toHaveBeenCalled();
  });

  it.each(['all', '31', '-30', '0', '365.0'])('rejects invalid history window %s', async days => {
    const response = await GET(request(`?days=${encodeURIComponent(days)}`));
    expect(response.status).toBe(400);
    expect(mocks.locationFindMany).not.toHaveBeenCalled();
  });
});
