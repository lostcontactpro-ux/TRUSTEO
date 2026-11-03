import { requireUser } from '@/lib/auth';
import { requireEntitlement } from '@/lib/entitlements';
import { connectionPreviewInput, testBusinessConnection } from '@/lib/connection-preview';
import { ownedConnection, providerApiError } from '@/lib/providers';
import { apiError, guardMutation, jsonBody, rateLimit } from '@/lib/security';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    guardMutation(request); const user = await requireUser(); await requireEntitlement(user);
    await rateLimit(`connection-preview:${user.id}`, 12, 60);
    const { id } = await params; const connection = await ownedConnection(id, user.id);
    const input = connectionPreviewInput.parse(await jsonBody(request));
    return Response.json(await testBusinessConnection(connection, user.id, input), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { try { providerApiError(error); } catch (mapped) { return apiError(mapped); } }
}
