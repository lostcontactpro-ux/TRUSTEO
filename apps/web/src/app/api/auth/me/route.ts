import { requireUser, publicUser } from '@/lib/auth';
import { apiError } from '@/lib/security';
export async function GET() {
  try { const user = await requireUser(); return Response.json({ user: publicUser(user), subscription: user.subscription }); }
  catch (error) { return apiError(error); }
}
