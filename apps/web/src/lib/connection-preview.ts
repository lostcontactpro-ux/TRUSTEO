import { z } from 'zod';
import type { ProviderConnection } from '@prisma/client';
import { decryptCredentials, encryptCredentials } from '@trusteo/core/crypto';
import { canOperateLocations, isEntitled } from '@trusteo/core/pricing';
import { isSafeSourceUrl, normalizedReviewSchema, type ProviderCredentials } from '@trusteo/core/providers/index';
import { db } from './db';
import { makeProvider, readProviderCredentials } from './providers';
import { constantTimeEqual, hashToken, HttpError, token } from './security';

export const CONNECTION_PREVIEW_TTL_MS = 10 * 60 * 1000;
const identifier = z.string().trim().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const connectionPreviewInput = z.object({
  authMethod: z.enum(['oauth', 'apiKey']),
  apiKey: z.string().trim().min(1).max(4096).optional(),
  accountId: identifier.optional(),
  remoteLocationId: identifier.optional(),
  businessUnitId: identifier.optional(),
}).strict().superRefine((input, ctx) => {
  if (input.authMethod === 'oauth' && input.apiKey) ctx.addIssue({ code: 'custom', path: ['apiKey'], message: 'La clé API est réservée à la connexion par clé.' });
});
export const connectionConfirmInput = z.object({ previewToken: z.string().regex(/^[a-f0-9]{64}$/), accepted: z.literal(true) }).strict();
export type ConnectionPreviewInput = z.infer<typeof connectionPreviewInput>;

const credentialSchema = z.object({
  accessToken: z.string().max(100000).optional(), refreshToken: z.string().max(100000).optional(), expiresAt: z.number().finite().optional(),
  apiKey: z.string().max(4096).optional(), accountId: identifier.optional(), remoteLocationId: identifier.optional(), businessUnitId: identifier.optional(),
}).strict();
const publicUrl = z.string().url().refine(isSafeSourceUrl);
const businessPreviewSchema = z.object({
  platform: z.string(), businessId: z.string().min(1).max(500), name: z.string().trim().min(1).max(500),
  address: z.string().max(2000).nullable(), website: publicUrl.nullable(), sourceUrl: publicUrl,
  rating: z.number().min(0).max(5).nullable(), reviewCount: z.number().int().nonnegative().nullable(),
  reviews: z.array(normalizedReviewSchema).max(3), authMethod: z.enum(['oauth', 'apiKey']), managementVerified: z.boolean(),
}).strict();
export type BusinessConnectionPreview = z.infer<typeof businessPreviewSchema>;
const receiptSchema = z.object({
  version: z.literal(1), userId: z.string(), connectionId: z.string(), sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  candidateCredentials: credentialSchema, preview: businessPreviewSchema, testedAt: z.coerce.date(), expiresAt: z.coerce.date(),
}).strict();
export type ConnectionPreviewReceipt = z.infer<typeof receiptSchema>;

export const clearedConnectionPreview = { pendingPreview: null, previewTokenHash: null, previewExpiresAt: null } as const;

/** Canonical semantic credentials, not randomized AES envelope bytes. A refresh
 * after the test invalidates confirmation rather than restoring an older token. */
export function connectionSnapshotFingerprint(connection: Pick<ProviderConnection, 'id' | 'locationId' | 'platform' | 'mode' | 'authMethod' | 'credentials'>): string {
  const credentials = readProviderCredentials(connection);
  const ordered = Object.fromEntries(Object.keys(credentials).sort().map(key => [key, credentials[key as keyof ProviderCredentials]]));
  return hashToken(JSON.stringify({ id: connection.id, locationId: connection.locationId, platform: connection.platform, mode: connection.mode, authMethod: connection.authMethod, credentials: ordered }));
}
function resourceIdentity(connection: ProviderConnection): string {
  const c = readProviderCredentials(connection);
  return JSON.stringify({ locationId: connection.locationId, platform: connection.platform, mode: connection.mode, authMethod: connection.authMethod, accountId: c.accountId, remoteLocationId: c.remoteLocationId, businessUnitId: c.businessUnitId, apiKey: c.apiKey });
}
export function candidatePreviewCredentials(connection: ProviderConnection, input: ConnectionPreviewInput): ProviderCredentials {
  if (connection.mode !== 'api') throw new HttpError(409, 'Le test de connexion est réservé au mode API.');
  if (!['google', 'trustpilot'].includes(connection.platform)) throw new HttpError(409, 'Cette plateforme utilise le mode email ou assisté.');
  if ((connection.platform !== 'google' && (input.accountId || input.remoteLocationId)) || (connection.platform !== 'trustpilot' && input.businessUnitId)) throw new HttpError(400, 'Identifiant incompatible avec la plateforme.');
  const stored = readProviderCredentials(connection);
  if (input.authMethod === 'apiKey') {
    if (connection.platform !== 'trustpilot') throw new HttpError(400, 'Google Business Profile nécessite OAuth ; une clé API ne suffit pas.');
    const apiKey = input.apiKey ?? stored.apiKey;
    const businessUnitId = input.businessUnitId ?? stored.businessUnitId;
    if (!apiKey || !businessUnitId) throw new HttpError(400, 'La clé API et le Business Unit ID Trustpilot sont requis.');
    // Deliberately exclude OAuth tokens: a public key never grants private replies.
    return { apiKey, businessUnitId };
  }
  if (!stored.accessToken && !stored.refreshToken) throw new HttpError(409, 'Connectez d’abord votre compte avec OAuth.');
  if (connection.platform === 'google') {
    const accountId = input.accountId ?? stored.accountId;
    const remoteLocationId = input.remoteLocationId ?? stored.remoteLocationId;
    if (!accountId || !remoteLocationId) throw new HttpError(400, 'Sélectionnez le compte et l’établissement Google.');
    return { accessToken: stored.accessToken, refreshToken: stored.refreshToken, expiresAt: stored.expiresAt, accountId, remoteLocationId };
  }
  const businessUnitId = input.businessUnitId ?? stored.businessUnitId;
  if (!businessUnitId) throw new HttpError(400, 'Le Business Unit ID Trustpilot est requis.');
  return { accessToken: stored.accessToken, refreshToken: stored.refreshToken, expiresAt: stored.expiresAt, businessUnitId };
}

export function readConnectionPreviewReceipt(connection: ProviderConnection, previewToken: string, userId: string, now = new Date()): ConnectionPreviewReceipt {
  if (connection.mode !== 'api' || !connection.pendingPreview || !connection.previewTokenHash || !connection.previewExpiresAt) throw new HttpError(409, 'Effectuez un nouveau test de connexion avant de confirmer.');
  if (!constantTimeEqual(hashToken(previewToken), connection.previewTokenHash)) throw new HttpError(403, 'Ce résultat de test ne correspond pas à la confirmation.');
  if (connection.previewExpiresAt <= now) throw new HttpError(409, 'Le test a expiré. Testez à nouveau la connexion.');
  let receipt: ConnectionPreviewReceipt;
  try { receipt = receiptSchema.parse(decryptCredentials(connection.pendingPreview)); }
  catch { throw new HttpError(409, 'Le résultat du test est invalide. Testez à nouveau la connexion.'); }
  if (receipt.connectionId !== connection.id || receipt.userId !== userId) throw new HttpError(403, 'Ce test appartient à une autre connexion.');
  if (receipt.expiresAt <= now || receipt.testedAt > now || receipt.expiresAt.getTime() !== connection.previewExpiresAt.getTime()) throw new HttpError(409, 'Le test a expiré ou doit être renouvelé.');
  if (!constantTimeEqual(receipt.sourceFingerprint, connectionSnapshotFingerprint(connection))) throw new HttpError(409, 'La connexion a changé depuis le test. Testez-la à nouveau.');
  if (receipt.preview.platform !== connection.platform || receipt.preview.authMethod === 'apiKey' && connection.platform !== 'trustpilot') throw new HttpError(409, 'Ce test ne correspond pas à la plateforme.');
  return receipt;
}

/** Invalidate prior proof before testing; only the most recent request may issue
 * a new receipt, even when an earlier slow read finishes after a newer failure. */
export async function testBusinessConnection(connection: ProviderConnection, userId: string, input: ConnectionPreviewInput) {
  const previewToken = token(); const previewTokenHash = hashToken(previewToken);
  const sourceConnection = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "ProviderConnection" WHERE id=${connection.id} FOR UPDATE`;
    const current = await tx.providerConnection.findFirst({ where: { id: connection.id, location: { userId } } });
    if (!current) throw new HttpError(404, 'Connexion introuvable.');
    if (connectionSnapshotFingerprint(current) !== connectionSnapshotFingerprint(connection)) throw new HttpError(409, 'La connexion a changé. Recommencez le test.');
    // A hash without pendingPreview is an in-flight generation marker, not a
    // confirmable receipt. Never change the active connection or its credentials.
    await tx.providerConnection.update({ where: { id: connection.id }, data: {
      ...clearedConnectionPreview, previewTokenHash,
      previewExpiresAt: new Date(Date.now() + CONNECTION_PREVIEW_TTL_MS),
    } });
    return current;
  });
  try {
    const candidateCredentials = candidatePreviewCredentials(sourceConnection, input);
    const provider = makeProvider({ ...sourceConnection, credentials: encryptCredentials(candidateCredentials), authMethod: input.authMethod });
    if (!provider.previewBusiness) throw new HttpError(409, 'Cette plateforme ne propose pas de test de fiche API.');
    const preview = businessPreviewSchema.parse(await provider.previewBusiness());
    if (preview.platform !== sourceConnection.platform || preview.authMethod !== input.authMethod || preview.businessId !== (candidateCredentials.remoteLocationId ?? candidateCredentials.businessUnitId)) throw new HttpError(502, 'La plateforme a renvoyé une fiche différente de celle sélectionnée.');
    if (preview.reviews.some(review => review.platform !== sourceConnection.platform || review.locationId !== sourceConnection.locationId)) throw new HttpError(502, 'Le résultat du test ne correspond pas à cet établissement.');
    if (input.authMethod === 'apiKey' && preview.managementVerified) throw new HttpError(502, 'Une clé de lecture publique ne peut pas vérifier la gestion de la fiche.');
    const testedAt = new Date(); const expiresAt = new Date(testedAt.getTime() + CONNECTION_PREVIEW_TTL_MS);
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "ProviderConnection" WHERE id=${sourceConnection.id} FOR UPDATE`;
      const current = await tx.providerConnection.findFirst({ where: { id: sourceConnection.id, location: { userId } } });
      if (!current) throw new HttpError(404, 'Connexion introuvable.');
      if (current.previewTokenHash !== previewTokenHash || resourceIdentity(current) !== resourceIdentity(sourceConnection)) throw new HttpError(409, 'Un nouveau test ou une modification a remplacé ce résultat. Recommencez.');
      const receipt: ConnectionPreviewReceipt = { version: 1, userId, connectionId: current.id, sourceFingerprint: connectionSnapshotFingerprint(current), candidateCredentials, preview, testedAt, expiresAt };
      await tx.providerConnection.update({ where: { id: current.id }, data: { pendingPreview: encryptCredentials(receipt), previewTokenHash, previewExpiresAt: expiresAt } });
    });
    return { previewToken, expiresAt, testedAt, preview };
  } catch (error) {
    // Do not erase proof issued by a later concurrent request. Only this failed
    // generation is invalidated, leaving active confirmed settings untouched.
    await db.providerConnection.updateMany({ where: { id: sourceConnection.id, location: { userId }, previewTokenHash }, data: clearedConnectionPreview });
    throw error;
  }
}

/** A row lock makes token consumption and activation atomic across web instances. */
export async function confirmBusinessConnection(id: string, userId: string, previewToken: string) {
  return db.$transaction(async tx => {
    // Location creation takes this same user lock; the plan cap is checked inside
    // the confirmation transaction, rather than relying on a browser snapshot.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${userId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "ProviderConnection" WHERE id=${id} FOR UPDATE`;
    const current = await tx.providerConnection.findFirst({ where: { id, location: { userId } } });
    if (!current) throw new HttpError(404, 'Connexion introuvable.');
    const user = await tx.user.findUnique({ where: { id: userId }, include: { subscription: true } });
    if (!user || !isEntitled(user.subscription)) throw new HttpError(402, 'Un essai ou abonnement actif est requis.');
    if (!canOperateLocations(user.subscription, await tx.location.count({ where: { userId } }))) throw new HttpError(403, 'La limite d’établissements de votre abonnement est dépassée.');
    const receipt = readConnectionPreviewReceipt(current, previewToken, userId);
    const previous = readProviderCredentials(current); const candidate = receipt.candidateCredentials;
    const changed = ['accountId', 'remoteLocationId', 'businessUnitId'].some(key => previous[key as keyof ProviderCredentials] !== candidate[key as keyof ProviderCredentials]);
    if (changed && await tx.review.count({ where: { connectionId: id } }) > 0) throw new HttpError(409, 'Cette connexion contient déjà des avis. Déconnectez-la avant de sélectionner une autre fiche.');
    const credentials = receipt.preview.authMethod === 'apiKey'
      ? { apiKey: candidate.apiKey, businessUnitId: candidate.businessUnitId }
      : { ...candidate, apiKey: undefined, accessToken: previous.accessToken, refreshToken: previous.refreshToken, expiresAt: previous.expiresAt };
    return tx.providerConnection.update({ where: { id }, data: {
      ...clearedConnectionPreview, credentials: encryptCredentials(credentials), authMethod: receipt.preview.authMethod,
      externalId: receipt.preview.businessId, testedAt: receipt.testedAt, confirmedAt: new Date(), status: 'connected', lastError: null,
    } });
  });
}
