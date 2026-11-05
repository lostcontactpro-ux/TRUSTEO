import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError } from '@/lib/security';
import { locationLimit, pricing } from '@trusteo/core/pricing';
export async function GET() {
  try {
    const user = await requireUser();
    const subscription = await db.subscription.findUnique({ where: { userId: user.id } });
    return Response.json({ pricing, subscription: subscription ? {
      plan: subscription.plan, interval: subscription.interval, status: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd, trialEndsAt: subscription.trialEndsAt,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      locationLimit: locationLimit(subscription), hasBillingAccount: !!subscription.stripeCustomerId,
    } : null });
  } catch (error) { return apiError(error); }
}
