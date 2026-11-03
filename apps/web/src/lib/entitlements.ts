import { canOperateLocations, isEntitled, locationLimit, type Entitlement } from '@trusteo/core/pricing';
import { db } from './db';
import { HttpError } from './security';
/** Call before third-party requests, polling, AI, replies, and campaign sends.
 * Read-only views and location removal intentionally remain available. */
export async function requireEntitlement(user: { id: string; subscription: Entitlement | null }): Promise<void> {
  if (!isEntitled(user.subscription)) throw new HttpError(402, 'Un abonnement actif ou un essai confirmé par Stripe est requis.');
  const count = await db.location.count({ where: { userId: user.id } });
  if (!canOperateLocations(user.subscription, count)) {
    throw new HttpError(403, `Votre compte compte ${count} établissements pour une limite de ${locationLimit(user.subscription)}. Supprimez les établissements en trop ou choisissez une formule adaptée pour reprendre les synchronisations, réponses et campagnes.`);
  }
}
