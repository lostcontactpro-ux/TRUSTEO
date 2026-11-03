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
  const signup = (plan: 'essential' | 'pro', interval: 'month' | 'year') => `${appOrigin}/signup?${new URLSearchParams({ plan, interval })}`;
  const links = {
    signup: `${appOrigin}/signup`,
    login: `${appOrigin}/login`,
    essentialMonth: signup('essential', 'month'),
    essentialYear: signup('essential', 'year'),
    proMonth: signup('pro', 'month'),
    proYear: signup('pro', 'year'),
    enterprise: `${appOrigin}/contact`,
  };
  const prompt = `Sur le site public existant ${LOVABLE_SITE_ORIGIN}, conserve le design, les couleurs, les sections, les textes et les cartes de tarifs. Modifie uniquement les destinations des boutons et des liens pour ouvrir l’application Trusteo Next.js à l’origine ${appOrigin}.

Applique ces destinations :
- Tous les boutons génériques « Essayer », « Démarrer mon essai » ou « S’inscrire » : ${links.signup}
- « Se connecter » : ${links.login}
- Essentiel avec facturation mensuelle : ${links.essentialMonth}
- Essentiel avec facturation annuelle : ${links.essentialYear}
- Pro avec facturation mensuelle : ${links.proMonth}
- Pro avec facturation annuelle : ${links.proYear}
- Entreprise, « Demander un devis » ou contact commercial : ${links.enterprise}

Le sélecteur mensuel/annuel doit changer la destination du bouton de chaque formule, en conservant les paramètres plan et interval ci-dessus. Utilise des liens de navigation normaux vers l’application, dans la même fenêtre, sans iframe.

Ne crée pas une seconde authentification, une seconde base de comptes ni une seconde facturation dans Lovable. Ne crée pas de formulaires de paiement sur ce site. N’ajoute aucune clé API ou clé Stripe dans le code client. N’appelle pas les API authentifiées de l’application depuis Lovable ; aucun partage de session, proxy ni réglage CORS n’est nécessaire pour ces simples liens. L’inscription, la connexion et Stripe restent gérés par l’application Next.js.

Vérifie les destinations des boutons du menu, du hero, des tarifs et du pied de page. Ne modifie pas le reste du site.`;
  return { siteOrigin: LOVABLE_SITE_ORIGIN, appOrigin, links, prompt };
}
