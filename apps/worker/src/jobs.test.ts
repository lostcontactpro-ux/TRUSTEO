import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ locationCount: vi.fn(), recipientFind: vi.fn(), recipientUpdate: vi.fn(), recipientCount: vi.fn(), campaignUpdate: vi.fn(), notificationFind: vi.fn(), connectionFind: vi.fn(), syncCreate: vi.fn(), syncUpdate: vi.fn(), connectionUpdate: vi.fn(), transaction: vi.fn(), redisSet: vi.fn(), redisEval: vi.fn(), queueAdd: vi.fn(), createProvider: vi.fn() }));
vi.mock('./runtime', () => ({
  db: { location:{count:mocks.locationCount}, campaignRecipient: { findUnique: mocks.recipientFind, update: mocks.recipientUpdate, count: mocks.recipientCount }, campaign: { updateMany: mocks.campaignUpdate }, notification: { findUnique: mocks.notificationFind }, providerConnection: { findUnique: mocks.connectionFind, update: mocks.connectionUpdate, updateMany: mocks.connectionUpdate }, syncLog: { create: mocks.syncCreate, update: mocks.syncUpdate }, $transaction: mocks.transaction },
  redis: { set: mocks.redisSet, eval: mocks.redisEval }, syncQueue: { add: mocks.queueAdd }, notificationQueue: { add: mocks.queueAdd }, deliveryQueue: {}, jobOptions: {},
}));
vi.mock('@trusteo/core/providers/index', async importOriginal => ({ ...await importOriginal<object>(), createProvider: mocks.createProvider }));
import { deliverRecipient, notifyReview, syncConnection } from './jobs';
import { encryptCredentials } from '@trusteo/core/crypto';
const subscription = { plan: 'essential', status: 'active', currentPeriodEnd: new Date('2099-01-01') };
function recipient(status = 'pending') {
  return { id: 'recipient1', status, sentAt: null, deliveryStartedAt: null, contact: { id: 'contact1', userId: 'owner1', email: 'client@example.test', name: 'Client', phone: '+33612345678', consentAt: new Date(), consentSource: 'checkout', unsubscribedAt: null, unsubscribeToken: 'unsubscribe1' }, campaign: { id: 'campaign1', status: 'queued', userId: 'owner1', channel: 'email', name: 'Après votre visite', locationId: 'location1', message: 'Merci de votre visite !', offer: null, location: { userId: 'owner1', name: 'Bistrot', reviewUrl: 'https://g.page/r/review' }, user: { id:'owner1', subscription } } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.locationCount.mockResolvedValue(1); mocks.recipientUpdate.mockResolvedValue({}); mocks.recipientCount.mockResolvedValue(0); mocks.campaignUpdate.mockResolvedValue({}); mocks.redisSet.mockResolvedValue('OK'); mocks.redisEval.mockResolvedValue(1); mocks.syncCreate.mockResolvedValue({ id: 'log1' }); mocks.syncUpdate.mockResolvedValue({}); mocks.connectionUpdate.mockResolvedValue({}); process.env.CREDENTIAL_ENCRYPTION_KEY = 'a'.repeat(64); });
describe('delivery consent and entitlement', () => {
  it('rechecks unsubscription immediately before send and marks the recipient skipped', async () => {
    const row = recipient(); row.contact.unsubscribedAt = new Date() as never; mocks.recipientFind.mockResolvedValue(row);
    await deliverRecipient(row.id); expect(mocks.recipientUpdate).toHaveBeenCalledWith({ where: { id: row.id }, data: { status: 'skipped', error: 'consent_missing_or_unsubscribed' } });
  });
  it('refuses cross-tenant campaign contact associations', async () => {
    const row = recipient(); row.contact.userId = 'other'; mocks.recipientFind.mockResolvedValue(row);
    await expect(deliverRecipient(row.id)).rejects.toThrow('tenant_mismatch'); expect(mocks.recipientUpdate).not.toHaveBeenCalled();
  });
  it('does not repeat an SMS after an ambiguous in-flight send', async () => {
    const row = recipient('sending'); row.campaign.channel = 'sms'; mocks.recipientFind.mockResolvedValue(row);
    await deliverRecipient(row.id); expect(mocks.recipientUpdate).toHaveBeenCalledWith({ where: { id: row.id }, data: { status: 'delivery_unknown', error: 'sms_delivery_requires_manual_check' } });
  });
  it('stops campaign delivery when a downgraded plan is over its location limit', async()=>{const row=recipient();mocks.recipientFind.mockResolvedValue(row);mocks.locationCount.mockResolvedValue(4);await expect(deliverRecipient(row.id)).rejects.toThrow('subscription_required');expect(mocks.locationCount).toHaveBeenCalledWith({where:{userId:'owner1'}});expect(mocks.recipientUpdate).not.toHaveBeenCalled();});
  it('does not send notifications for an expired subscription', async () => {
    mocks.notificationFind.mockResolvedValue({ user: { subscription: { ...subscription, currentPeriodEnd: new Date(0) } } });
    await expect(notifyReview('review1')).resolves.toBeUndefined();
  });
});
describe('sync watermark and credential safety', () => {
  it('never polls an API connection before explicit business confirmation',async()=>{mocks.connectionFind.mockResolvedValue({id:'connection1',status:'connected',mode:'api',confirmedAt:null,location:{userId:'owner1',user:{id:'owner1',subscription}}});await syncConnection('connection1');expect(mocks.createProvider).not.toHaveBeenCalled();expect(mocks.syncCreate).not.toHaveBeenCalled();});
  it('does not advance the sync watermark after an upstream failure', async () => {
    mocks.connectionFind.mockResolvedValue({ id: 'connection1', status: 'connected', confirmedAt:new Date(), mode: 'api', platform: 'google', locationId: 'location1', credentials: encryptCredentials({ accessToken: 'token' }), lastSyncedAt: new Date(0), location: { userId:'owner1', name: 'Bistrot', user: { id:'owner1', subscription } } });
    mocks.createProvider.mockReturnValue({ fetchReviews: async () => { throw new Error('upstream token=secret'); } });
    await expect(syncConnection('connection1')).rejects.toThrow('operation_failed');
    expect(mocks.connectionUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lastSyncedAt: expect.anything() }) }));
    expect(mocks.syncUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed', error: 'operation_failed' }) }));
  });
});
