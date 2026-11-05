import { annualSavings, formatPrice, paymentLinkFor, pricing } from '@trusteo/core/pricing';

/** Navigation-only integration with the existing public Lovable site.
 * Validation checks the origin syntax; it does not verify deployment or DNS. */
export const LOVABLE_SITE_ORIGIN = 'https://trus-teo.lovable.app' as const;

export type LovableIntegration = {
  siteOrigin: typeof LOVABLE_SITE_ORIGIN;
  appOrigin: string;
  links: {
    signup: string;
    login: string;
    essentialMonth: string;
    essentialYear: string;
    proMonth: string;
    proYear: string;
    enterprise: string;
  };
  prompt: string;
};

const invalidOriginMessage = 'Indiquez l’origine HTTPS publique réelle de l’application Next.js, sans identifiants, chemin, paramètres ni fragment. Les adresses locales, les exemples et l’adresse du site Lovable ne conviennent pas.';
const reservedSuffixes = ['localhost', 'local', 'internal', 'lan', 'home', 'test', 'invalid', 'example', 'onion', 'alt', 'intranet', 'private'];
const exampleDomains = ['example.com', 'example.net', 'example.org', 'exemple.com', 'exemple.fr'];

function publicAppOrigin(value: string): string {
  if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value)) throw new Error(invalidOriginMessage);
  // Check the supplied shape before URL normalization: /something/.., empty
  // query markers, URL credentials and backslashes must not become an origin.
  const match = /^https:\/\/([^/?#]+)\/?$/i.exec(value);
  if (!match || /[@\\%]/.test(match[1])) throw new Error(invalidOriginMessage);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(invalidOriginMessage); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/' || url.port) throw new Error(invalidOriginMessage);
  const host = url.hostname;
  const labels = host.split('.');
  if (host.length > 253 || labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) throw new Error(invalidOriginMessage);
  // Requiring a DNS top-level label excludes every normalized IPv4 form; IPv6
  // literals are rejected by the label rules above. No network probe is made.
  const topLevel = labels.at(-1)!;
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(topLevel) || reservedSuffixes.includes(topLevel)) throw new Error(invalidOriginMessage);
  if (labels.some(label => label === 'localhost')) throw new Error(invalidOriginMessage);
  if (exampleDomains.some(domain => host === domain || host.endsWith(`.${domain}`))) throw new Error(invalidOriginMessage);
  if (url.origin === LOVABLE_SITE_ORIGIN) throw new Error(invalidOriginMessage);
  return url.origin;
}

export function buildLovableIntegration(origin: string): LovableIntegration {
  const appOrigin = publicAppOrigin(origin);
  const payments = buildLovablePaymentIntegration();
  const links = {
    signup: `${appOrigin}/signup`,
    login: `${appOrigin}/login`,
    ...payments.links,
    enterprise: `${appOrigin}/contact`,
  };
  const prompt = `${payments.prompt}

L’application Trusteo Next.js est à l’origine ${appOrigin}. Pour les liens de compte et de contact :
- « S’inscrire » ou « Créer mon compte » : ${links.signup}
- « Se connecter » : ${links.login}
- Entreprise, « Demander un devis » ou contact commercial : ${links.enterprise}

Le paiement effectué directement sur Stripe sera rattaché au compte via le lien de vérification reçu par email. La page « Mon abonnement » de l’application contient la gestion Stripe et l’annulation du renouvellement. N’ajoute pas un bouton qui simule une annulation dans Lovable : ce bouton doit ouvrir ${appOrigin}/app/settings. Ne crée pas une seconde authentification, une seconde base de comptes ni une seconde facturation dans Lovable. N’appelle pas les API authentifiées de l’application depuis Lovable ; aucun partage de session, proxy ni réglage CORS n’est nécessaire pour ces simples liens.`;
  return { siteOrigin: LOVABLE_SITE_ORIGIN, appOrigin, links, prompt };
}

/** Pricing links can be installed in Lovable before an app origin is available.
 * They do not activate a backend or change any remote Stripe configuration. */
export function buildLovablePaymentIntegration() {
  const links = {
    essentialMonth: paymentLinkFor('essential', 'month'),
    essentialYear: paymentLinkFor('essential', 'year'),
    proMonth: paymentLinkFor('pro', 'month'),
    proYear: paymentLinkFor('pro', 'year'),
  };
  const essential = annualSavings('essential');
  const pro = annualSavings('pro');
  const prompt = `Sur mon site ${LOVABLE_SITE_ORIGIN}, conserve le design, les couleurs et les sections existantes. Mets à jour les cartes de tarifs Trusteo et leurs boutons avec ces liens Stripe publics exacts :

- Essentiel mensuel : ${links.essentialMonth}
- Essentiel annuel : ${links.essentialYear}
- Pro mensuel : ${links.proMonth}
- Pro annuel : ${links.proYear}

Le sélecteur mensuel/annuel change à la fois le tarif et le href du bouton. Utilise des liens normaux dans la même fenêtre, sans iframe, ni paiement embarqué. N’ajoute aucune clé API ou clé Stripe dans le code client.

Mets l’annuel en avant, sélectionné par défaut. Essentiel : ${formatPrice(pricing.essential.yearly)}/an, soit environ ${formatPrice(essential.monthlyEquivalentCents)}/mois, payé en une fois ; économie ${formatPrice(essential.savingsCents)}/an (${essential.percent.toLocaleString('fr-FR')} %). Pro : ${formatPrice(pricing.pro.yearly)}/an, soit environ ${formatPrice(pro.monthlyEquivalentCents)}/mois, payé en une fois ; économie ${formatPrice(pro.savingsCents)}/an (${pro.percent.toLocaleString('fr-FR')} %). Précise que les économies comparent douze mensualités au tarif normal, hors remise de bienvenue. Évite fausse urgence, faux témoignages ou économies calculées contre un prix inventé.

Sur l’annuel, affiche « Sans essai gratuit — paiement annuel immédiat » et un bouton « Choisir l’annuel ». Les avantages annuels réels de l’application sont l’analyse de réputation sur 90 et 365 jours et l’export CSV des avis. Les fonctionnalités communes restent : avis centralisés, trois tons de réponse IA, notifications, campagnes conformes, parrainage et fidélité. Essentiel : jusqu’à ${pricing.essential.maxLocations} établissements ; Pro : jusqu’à ${pricing.pro.maxLocations}. Ne promets pas de support premium ou de service non livré.

Sur le mensuel, affiche ${formatPrice(pricing.essential.monthly)}/mois pour Essentiel et ${formatPrice(pricing.pro.monthly)}/mois pour Pro. L’essai de ${pricing.trialDays} jours avec carte et la remise de ${pricing.introductoryDiscount.percent} % sur les ${pricing.introductoryDiscount.months} premières mensualités sont réservés aux nouveaux clients éligibles, un seul essai par client, sous réserve des réglages Stripe. Le tarif annuel ne cumule pas cette remise. Vérifie qu’aucun texte de la FAQ, du hero ou des tarifs ne promet un essai sur l’annuel.

Annonce le renouvellement automatique et la possibilité d’annuler le renouvellement depuis le compte, avec accès jusqu’à l’échéance. Ne simule ni activation d’abonnement ni annulation côté navigateur : ces actions reposent sur le serveur Trusteo et les événements signés Stripe. Garde les boutons accessibles au clavier et vérifie le rendu à 375 px.`;
  return { siteOrigin: LOVABLE_SITE_ORIGIN, links, prompt };
}
