import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), rateLimit: vi.fn(),
  locationFindFirst: vi.fn(), reviewCount: vi.fn(), reviewFindMany: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireUser: mocks.requireUser }));
vi.mock('@/lib/db', () => ({ db: {
  location: { findFirst: mocks.locationFindFirst },
  review: { count: mocks.reviewCount, findMany: mocks.reviewFindMany },
} }));
vi.mock('@/lib/security', async original => ({ ...await original<object>(), rateLimit: mocks.rateLimit }));

import { HttpError } from '@/lib/security';
import { GET } from './route';

const now = new Date('2026-11-05T12:00:00.000Z');
const paidThrough = new Date('2027-11-05T12:00:00.000Z');
const annual = { plan: 'essential', status: 'active', interval: 'year', currentPeriodEnd: paidThrough };
const owner = { id: 'merchant-one', subscription: annual };
const rows = [
  { id: 'review-a', externalId: 'external-a', locationId: 'location-one', location: { id: 'location-one', name: 'Café du Centre', userId: owner.id }, platform: 'google', author: '=1+1', rating: 4, text: 'Good "meal",\nthanks', language: 'en', publishedAt: new Date('2026-10-20T10:00:00Z'), repliedAt: null, replyText: null, status: 'pending', sourceUrl: 'https://example.com/review-a' },
  { id: 'review-b', externalId: 'external-b', locationId: 'location-two', location: { id: 'location-two', name: 'Other shop', userId: 'merchant-two' }, platform: 'trustpilot', author: 'Foreign author', rating: 1, text: 'PRIVATE FOREIGN REVIEW', language: 'en', publishedAt: new Date('2026-10-21T10:00:00Z'), repliedAt: null, replyText: null, status: 'pending', sourceUrl: null },
  { id: 'review-old', externalId: 'external-old', locationId: 'location-one', location: { id: 'location-one', name: 'Café du Centre', userId: owner.id }, platform: 'google', author: 'Old author', rating: 5, text: 'OUTSIDE SELECTED WINDOW', language: 'en', publishedAt: new Date('2025-01-01T10:00:00Z'), repliedAt: null, replyText: null, status: 'pending', sourceUrl: null },
];

type Query = { where?: { location?: { userId?: string }; locationId?: string; publishedAt?: { gte?: Date; lte?: Date }; id?: { gt?: string } }; take?: number; cursor?: { id: string }; skip?: number };
function visible(query: Query) {
  const { where } = query;
  return rows.filter(row => (!where?.location?.userId || row.location.userId === where.location.userId)
    && (!where?.locationId || row.locationId === where.locationId)
    && (!where?.publishedAt?.gte || row.publishedAt >= where.publishedAt.gte)
    && (!where?.publishedAt?.lte || row.publishedAt <= where.publishedAt.lte)
    && (!where?.id?.gt || row.id > where.id.gt));
}
function request(query = '') { return new Request(`http://localhost:3000/api/reports/reviews.csv${query}`); }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now); vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(owner);
  mocks.rateLimit.mockResolvedValue(undefined);
  mocks.locationFindFirst.mockImplementation(async ({ where }: { where: { id: string; userId: string } }) => {
    const location = rows.find(row => row.locationId === where.id && row.location.userId === where.userId)?.location;
    return location ?? null;
  });
  mocks.reviewCount.mockImplementation(async (query: Query) => visible(query).length);
  mocks.reviewFindMany.mockImplementation(async (query: Query) => {
    const selected = visible(query); const cursor = query.cursor ? selected.findIndex(row => row.id === query.cursor!.id) : 0;
    return selected.slice(Math.max(cursor, 0) + (query.skip ?? 0), Math.max(cursor, 0) + (query.skip ?? 0) + (query.take ?? selected.length));
  });
});
afterEach(() => { vi.useRealTimers(); });

describe('annual review CSV authorization', () => {
  it.each([
    ['monthly', { ...annual, interval: 'month' }],
    ['expired annual', { ...annual, currentPeriodEnd: new Date('2026-11-04T00:00:00Z') }],
    ['annual trial', { ...annual, status: 'trialing', trialEndsAt: paidThrough }],
    ['no subscription', null],
  ])('denies %s before querying review data', async (_label, subscription) => {
    mocks.requireUser.mockResolvedValueOnce({ ...owner, subscription });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(mocks.reviewCount).not.toHaveBeenCalled();
    expect(mocks.reviewFindMany).not.toHaveBeenCalled();
  });

  it('requires authentication before exporting', async () => {
    mocks.requireUser.mockRejectedValueOnce(new HttpError(401, 'Connexion requise.'));
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(mocks.reviewCount).not.toHaveBeenCalled();
  });

  it('rejects a foreign location without querying its reviews', async () => {
    const response = await GET(request('?days=30&locationId=location-two'));
    expect(response.status).toBe(404);
    expect(mocks.reviewCount).not.toHaveBeenCalled();
    expect(mocks.reviewFindMany).not.toHaveBeenCalled();
  });
});

describe('annual review CSV contents and limits', () => {
  it('exports only owned reviews inside the selected period and protects spreadsheet formulas', async () => {
    const response = await GET(request('?days=30'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('attachment;');
    expect(response.headers.get('cache-control')).toContain('no-store');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain('Café du Centre');
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('Good ""meal"",\nthanks');
    expect(csv).not.toContain('PRIVATE FOREIGN REVIEW');
    expect(csv).not.toContain('OUTSIDE SELECTED WINDOW');
  });

  it('applies an owned location filter and the configured rate limit', async () => {
    const response = await GET(request('?days=90&locationId=location-one'));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Café du Centre');
    expect(mocks.rateLimit).toHaveBeenCalled();
    expect(mocks.reviewCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ locationId: 'location-one', location: expect.objectContaining({ userId: owner.id }) }) }));
  });

  it('streams every owned row exactly once across pages while retaining account and date constraints', async () => {
    const owned = Array.from({ length: 501 }, (_, index) => ({
      ...rows[0], id: `review-${String(index).padStart(4, '0')}`,
      author: `Client ${index}`, text: `report-marker-${String(index).padStart(4, '0')}`,
    }));
    const source = [...owned, { ...rows[1], id: 'review-0250-foreign' }].sort((left, right) => left.id.localeCompare(right.id));
    mocks.reviewCount.mockResolvedValueOnce(501);
    mocks.reviewFindMany.mockImplementation(async (query: Query) => {
      const selected = source.filter(row => (!query.where?.location?.userId || row.location.userId === query.where.location.userId)
        && (!query.where?.publishedAt?.gte || row.publishedAt >= query.where.publishedAt.gte)
        && (!query.where?.publishedAt?.lte || row.publishedAt <= query.where.publishedAt.lte));
      const offset = query.cursor ? selected.findIndex(row => row.id === query.cursor!.id) + (query.skip ?? 0) : 0;
      return selected.slice(offset, offset + (query.take ?? selected.length));
    });

    const response = await GET(request('?days=30'));
    expect(response.status).toBe(200);
    const csv = await response.text();
    const markers = csv.match(/report-marker-\d{4}/g) ?? [];
    expect(markers).toHaveLength(501);
    expect(new Set(markers)).toEqual(new Set(owned.map(row => row.text)));
    expect(csv).not.toContain('PRIVATE FOREIGN REVIEW');
    expect(mocks.reviewFindMany).toHaveBeenCalledTimes(2);
    for (const [query] of mocks.reviewFindMany.mock.calls as [Query][]) {
      expect(query.where).toMatchObject({
        location: { userId: owner.id },
        publishedAt: { gte: new Date('2026-10-07T00:00:00.000Z'), lte: now },
      });
    }
    expect(mocks.reviewFindMany.mock.calls[0][0]).toMatchObject({ take: 500 });
    expect(mocks.reviewFindMany.mock.calls[1][0]).toMatchObject({ take: 1, cursor: { id: 'review-0499' }, skip: 1 });
  });

  it('refuses an oversized report instead of silently truncating it', async () => {
    mocks.reviewCount.mockResolvedValueOnce(10_001);
    const response = await GET(request('?days=365'));
    expect(response.status).toBe(413);
    expect(mocks.reviewFindMany).not.toHaveBeenCalled();
  });

  it.each(['1', '31', '0', '-1', 'all', '365.0'])('rejects unsupported window %s', async days => {
    const response = await GET(request(`?days=${encodeURIComponent(days)}`));
    expect(response.status).toBe(400);
    expect(mocks.reviewCount).not.toHaveBeenCalled();
  });
});
