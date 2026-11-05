import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, rateLimit } from '@/lib/security';
export async function GET() {
  try {
    const user = await requireUser(); await rateLimit(`export:${user.id}`, 5, 3600);
    const data = await db.user.findUnique({ where: { id: user.id }, select: {
      id: true, email: true, firstName: true, lastName: true, phone: true, notifyEmail: true, notifyPush: true, consentAt: true, createdAt: true,
      subscription: { select: { plan: true, status: true, interval: true, trialEndsAt: true, currentPeriodEnd: true, cancelAtPeriodEnd: true } },
      locations: { select: { id: true, name: true, address: true, city: true, reviewUrl: true, reviews: { include: { drafts: true } }, connections: { select: { platform: true, mode: true, status: true, externalId: true, lastSyncedAt: true } } } },
      contacts: true, campaigns: { include: { recipients: true } }, referrals: true, redemptions: true, notifications: true,
    } });
    const payments = await db.paymentReceipt.findMany({ where: { claimedUserId: user.id }, select: {
      checkoutSessionId: true, stripeCustomerId: true, stripeSubscriptionId: true,
      email: true, plan: true, interval: true, createdAt: true, claimedAt: true,
    } });
    return new Response(JSON.stringify({ exportedAt: new Date().toISOString(), data, payments }, null, 2), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="trusteo-data.json"', 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
