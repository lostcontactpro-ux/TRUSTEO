import { Resend } from 'resend';
import { requiredEnv } from './env';

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function mailConfigured(): boolean { return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM); }

export async function sendMail(input: { to: string; subject: string; html: string; text?: string; idempotencyKey?: string }): Promise<void> {
  const resend = new Resend(requiredEnv('RESEND_API_KEY'));
  const { idempotencyKey, ...message } = input;
  const result = await resend.emails.send({ from: requiredEnv('EMAIL_FROM'), ...message }, idempotencyKey ? { idempotencyKey } : undefined);
  if (result.error) throw new Error('Email delivery failed');
}
