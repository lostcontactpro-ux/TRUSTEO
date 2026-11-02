import { z } from 'zod';
import { db } from '@/lib/db';
import { apiError, guardMutation, hashToken, HttpError, jsonBody, rateLimit, token } from '@/lib/security';
import { mailConfigured, sendMail, escapeHtml } from '@/lib/mail';
import { appUrl } from '@/lib/env';
const schema = z.object({ email: z.string().trim().email().max(254).transform((s) => s.toLowerCase()) }).strict();
export async function POST(request: Request) {
  try {
    guardMutation(request);
    await rateLimit('password-reset:global', 100, 3600);
    const { email } = schema.parse(await jsonBody(request));
    await rateLimit(`password-reset:${email}`, 3, 3600);
    if (!mailConfigured()) throw new HttpError(503, 'Le service email doit être configuré pour réinitialiser un mot de passe.');
    const user = await db.user.findUnique({ where: { email } });
    if (user) {
      const raw = token();
      await db.$transaction([
        db.passwordReset.deleteMany({ where: { userId: user.id } }),
        db.passwordReset.create({ data: { userId: user.id, tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 30 * 60 * 1000) } }),
      ]);
      const link = `${appUrl()}/reset-password?token=${raw}`;
      await sendMail({ to: email, subject: 'Réinitialisez votre mot de passe Trusteo', text: `Pour réinitialiser votre mot de passe, ouvrez ce lien valable 30 minutes : ${link}. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.`, html: `<p>Une demande de réinitialisation a été faite pour votre compte Trusteo.</p><p><a href="${escapeHtml(link)}">Choisir un nouveau mot de passe</a> (30 minutes).</p><p>Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>` });
    }
    return Response.json({ message: 'Si ce compte existe, un email de réinitialisation lui a été envoyé.' });
  } catch (error) { return apiError(error); }
}
