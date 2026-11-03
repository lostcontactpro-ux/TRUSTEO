import { requireUser } from '@/lib/auth';
import { requireEntitlement } from '@/lib/entitlements';
import { connectionConfirmInput, confirmBusinessConnection } from '@/lib/connection-preview';
import { publicConnection, queueProviderSync } from '@/lib/providers';
import { apiError, guardMutation, jsonBody, rateLimit } from '@/lib/security';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    guardMutation(request); const user = await requireUser(); await requireEntitlement(user);
    await rateLimit(`connection-confirm:${user.id}`, 12, 60);
    const { id } = await params; const input = connectionConfirmInput.parse(await jsonBody(request));
    const connection = await confirmBusinessConnection(id, user.id, input.previewToken);
    let syncQueued = false;
    try { await queueProviderSync(connection.id); syncQueued = true; }
    catch { /* The committed confirmation remains valid; polling can recover it. */ }
    return Response.json({ connection: publicConnection(connection), syncQueued,
      message: syncQueued ? 'Établissement confirmé. La synchronisation est programmée.' : 'Établissement confirmé. La synchronisation n’a pas pu être programmée ; réessayez depuis Connexions.' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
