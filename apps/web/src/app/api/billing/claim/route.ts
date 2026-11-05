import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { stripeClient } from '@/lib/billing';
import { claimPaymentReceipt } from '@/lib/payment-receipts';
import { apiError, guardMutation, jsonBody, rateLimit } from '@/lib/security';
export async function POST(request: Request) {
  try {
    guardMutation(request); const user = await requireUser(); await rateLimit(`payment-claim:${user.id}`, 10, 60);
    const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(await jsonBody(request));
    return Response.json(await claimPaymentReceipt(stripeClient(), user.id, token), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
