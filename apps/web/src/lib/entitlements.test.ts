import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock('./db', () => ({ db: { location: { count: fixture.count } } }));
vi.mock('./security', () => ({ HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));
import { requireEntitlement } from './entitlements';
const subscription = { plan: 'essential', status: 'active', currentPeriodEnd: new Date(Date.now() + 86_400_000) };
beforeEach(() => fixture.count.mockReset());
describe('aggregate server entitlement guard', () => {
  it('allows operations at the exact paid location cap', async () => {
    fixture.count.mockResolvedValue(3);
    await expect(requireEntitlement({ id: 'owner', subscription })).resolves.toBeUndefined();
    expect(fixture.count).toHaveBeenCalledWith({ where: { userId: 'owner' } });
  });
  it('blocks billable operations over a downgraded plan without deleting data', async () => {
    fixture.count.mockResolvedValue(4);
    await expect(requireEntitlement({ id: 'owner', subscription })).rejects.toMatchObject({ status: 403, message: expect.stringContaining('Supprimez') });
  });
  it('rejects an unpaid account before querying billable resources', async () => {
    await expect(requireEntitlement({ id: 'owner', subscription: { ...subscription, status: 'incomplete' } })).rejects.toMatchObject({ status: 402 });
    expect(fixture.count).not.toHaveBeenCalled();
  });
  it('does not grant enterprise capacity without an explicit configured cap', async () => {
    fixture.count.mockResolvedValue(0);
    await expect(requireEntitlement({ id: 'owner', subscription: { ...subscription, plan: 'enterprise' } })).rejects.toMatchObject({ status: 403 });
  });
});
