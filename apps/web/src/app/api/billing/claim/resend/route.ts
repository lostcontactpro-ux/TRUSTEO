import { z } from 'zod';
import { requireUser } from '@/lib/auth';
import { stripeClient } from '@/lib/billing';
import { resendPaymentReceipts } from '@/lib/payment-receipts';
import { apiError, guardMutation, jsonBody, rateLimit } from '@/lib/security';
export async function POST(request: Request) {
  try {
    guardMutation(request); const user = await requireUser();
    z.object({}).strict().parse(await jsonBody(request));
    await rateLimit('payment-claim-resend:global', 1000, 3600);
    await rateLimit(`payment-claim-resend:user:${user.id}`, 3, 3600);
    await rateLimit(`payment-claim-resend:email:${user.email.trim().toLowerCase()}`, 3, 3600);
    await resendPaymentReceipts(stripeClient(), user.email);
    return Response.json({ message: 'Si un paiement attend un rattachement pour votre adresse email, un nouveau lien vous sera envoyé.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
