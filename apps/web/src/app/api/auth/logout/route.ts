import { destroySession } from '@/lib/auth';
import { apiError, guardMutation } from '@/lib/security';
export async function POST(request: Request) {
  try { guardMutation(request); await destroySession(); return Response.json({ ok: true }); }
  catch (error) { return apiError(error); }
}
