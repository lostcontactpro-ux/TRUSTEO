import { requireUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { apiError, guardMutation, HttpError, rateLimit } from '@/lib/security';
import { appUrl, stripeClient } from '@/lib/billing';
export async function POST(request: Request) {
  try {
    guardMutation(request);
    const user = await requireUser();
    await rateLimit(`portal:${user.id}`, 10, 60);
    const subscription = await db.subscription.findUnique({ where: { userId: user.id } });
    if (!subscription?.stripeCustomerId) throw new HttpError(400, 'Aucun compte de facturation associé.');
    const session = await stripeClient().billingPortal.sessions.create({ customer: subscription.stripeCustomerId, return_url: `${appUrl()}/app/settings` });
    return Response.json({ url: session.url });
  } catch (error) { return apiError(error); }
}
