# Trusteo

Gestion des avis et de la réputation pour restaurateurs, commerces et entreprises en ligne. Interface mobile, réponses IA à valider, campagnes neutres, parrainage et fidélité. Les avis clients restent authentiques : aucune création de faux avis, aucune sélection des invitations selon la satisfaction et aucune promotion en contrepartie d'un avis.

## Installation locale

Prérequis : **Node.js 24**, npm et Docker Compose. Le dépôt est un monorepo npm workspaces : `apps/web` (Next.js), `apps/worker` (BullMQ), `packages/core` (logique métier et providers).

```bash
cp .env.example .env
# Renseigner CREDENTIAL_ENCRYPTION_KEY avec une clé générée par openssl rand -hex 32.
npm ci
docker compose up -d postgres redis
ln -s ../../.env apps/web/.env
npm run providers:generate
npm run db:generate
npm run db:migrate
npm run dev
```

Ne recréez pas le lien `.env` s'il existe déjà. Dans un deuxième terminal :

```bash
npm run worker
```

Le site local utilise le port 3000. Le worker reste nécessaire pour le polling toutes les 10 minutes, les notifications et les campagnes ; lancer le site seul ne traite pas ces jobs. `APP_URL` doit correspondre exactement à l'origine du navigateur pour les protections CSRF.

Pour tout lancer sous Docker en développement :

```bash
# Le fichier .env et sa clé de chiffrement restent nécessaires.
docker compose --profile app up --build
```

Les valeurs PostgreSQL et Redis de Compose sont réservées au développement. Les ports sont liés à l'interface locale. Le profil `app` exécute les migrations avant le web et le worker.

## Préparation de cet environnement cloud

Dans le checkout isolé existant `/workspace/TRUSTEO`, le script [scripts/cloud-install.sh](scripts/cloud-install.sh) installe les dépendances, prépare le fichier local `.env` sans remplacer une clé existante, génère Prisma, démarre PostgreSQL/Redis et applique les migrations :

```bash
bash scripts/cloud-install.sh
npm run dev
# Dans un autre terminal, depuis la même racine :
npm run worker
```

Ce script utilise les conteneurs locaux `trusteo-postgres` et `trusteo-redis` et les identifiants de développement de `.env.example` ; conservez une configuration cohérente si vous fournissez une base externe. Il prépare la machine actuelle, sans publier l'environnement ni configurer automatiquement les comptes des services tiers. Utilisez le checkout existant ; aucun worktree supplémentaire n'est nécessaire.

## Ce qui fonctionne sans services externes

L'inscription, les sessions, le compte, les préférences et l'export/suppression peuvent être développés avec PostgreSQL. Les fonctionnalités payantes exigent un abonnement confirmé par webhook Stripe ; l'inscription seule n'active pas artificiellement un essai. Les connexions API, la génération IA et l'envoi de messages nécessitent leurs véritables identifiants. L'application signale leur absence, sans simuler une publication ou un paiement.

Le mode assisté copie une réponse puis ouvre la plateforme ; il ne prétend pas publier. Google Business Profile et Trustpilot ont des transports API officiels testés avec des réponses HTTP simulées. Les autres plateformes utilisent les capacités, l'email ou le mode assisté documentés dans [docs/providers.md](docs/providers.md). Les autorisations API des plateformes restent à obtenir.

## Connecter mon entreprise

Le [parcours de connexion](docs/connect-my-business.md) ajoute un aperçu réel, un test en lecture seule et une confirmation explicite avant activation. Il se trouve dans `/app/connections`. Google exige OAuth ; une clé Trustpilot propose une lecture seule sans preuve de gestion.

## Qui connecte Google et Trustpilot ?

Chaque entreprise cliente connecte **son propre compte** depuis son espace Trusteo : Connexions → choisir un établissement → Connecter Google ou Trustpilot → se connecter sur la plateforme → autoriser Trusteo → sélectionner la fiche concernée. Le client ne fournit jamais son mot de passe à Trusteo. Ses connexions, avis et jetons d'autorisation chiffrés sont rattachés à son compte et à ses établissements.

L'exploitant de Trusteo configure une seule fois **l'application d'intégration** : projet/consentement OAuth et accès API Google, application et accès API Trustpilot, identifiants OAuth de Trusteo et URL de retour. Ces identifiants identifient le logiciel ; ils ne remplacent pas l'autorisation des commerces et ne sont pas les identifiants de connexion des clients. Aucun compte de commerçant global ne sert à lire les avis de tous les utilisateurs.

Les droits de gestion d'une fiche Google et, pour Trustpilot, les droits et conditions d'accès API du compte connecté restent nécessaires. Une intégration OAuth enregistrée ne garantit pas un accès API pour toute offre Trustpilot.

## Configuration à fournir pour l’application Trusteo

Le détail des variables est dans [.env.example](.env.example). Conservez les secrets dans les variables du fournisseur d'hébergement, jamais dans Git ni dans le navigateur.

| Service | Configuration nécessaire |
| --- | --- |
| Base et file | `DATABASE_URL`, `REDIS_URL`, `APP_URL` HTTPS en production |
| Chiffrement | `CREDENTIAL_ENCRYPTION_KEY` : 32 octets aléatoires encodés en 64 caractères hexadécimaux ; sauvegarder durablement |
| Stripe | Clé secrète, secret webhook, quatre IDs de prix, Customer Portal activé ; coupon d'introduction facultatif car création automatique possible |
| OpenAI | `OPENAI_API_KEY`, ou `TRUSTEO_OPENAI_API_KEY` pour une liaison proxy cloud, et modèle `OPENAI_MODEL` autorisé pour votre projet |
| Google | Application Trusteo : projet Google Cloud, accès Business Profile approuvé, consentement OAuth, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Chaque client autorise ensuite son propre compte. |
| Trustpilot | Application Trusteo : accès Business API et `TRUSTPILOT_CLIENT_ID` / `TRUSTPILOT_CLIENT_SECRET`. Chaque client autorise son compte Business avec les droits API requis. |
| Resend | `RESEND_API_KEY`, domaine expéditeur vérifié SPF/DKIM, `EMAIL_FROM`, adresse de réception `CONTACT_EMAIL`, politique DMARC |
| Emails entrants | Sous-domaine `INBOUND_EMAIL_DOMAIN`, routage entrant et passerelle vérifiant DKIM/ARC ; secret `INBOUND_WEBHOOK_SECRET` partagé avec cette passerelle |
| Push | Clés VAPID ; même clé publique dans `VAPID_PUBLIC_KEY` et `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, plus clé privée et sujet |
| SMS facultatif | Compte Twilio, numéro expéditeur approuvé, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` |

### Stripe

Les tarifs sont centralisés dans [packages/core/src/pricing.ts](packages/core/src/pricing.ts). Créez dans Stripe quatre prix récurrents **EUR** et renseignez leurs IDs :

| Variable | Prix |
| --- | --- |
| `STRIPE_PRICE_ESSENTIAL_MONTH` | 49,80 € / mois |
| `STRIPE_PRICE_ESSENTIAL_YEAR` | 409 € / an |
| `STRIPE_PRICE_PRO_MONTH` | 109 € / mois |
| `STRIPE_PRICE_PRO_YEAR` | 980 € / an |

Le checkout exige une carte, accorde 14 jours d'essai au premier abonnement, puis applique 20 % pendant deux mois aux abonnements mensuels. Les tarifs annuels ont déjà leur propre réduction ; le coupon de deux mois ne s'applique pas à l'annuel. Configurez un coupon `repeating`, `percent_off=20`, `duration_in_months=2`, ou laissez le code créer son ID stable. Le serveur vérifie également les prix et le coupon.

Enregistrez l'endpoint HTTPS `/api/billing/webhook` avec les événements `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `checkout.session.completed`, `checkout.session.expired`. Activez le Customer Portal pour la gestion et l'annulation ; évitez d'y proposer des changements de formule qui dépasseraient les limites d'établissements sans contrôle applicatif. N'activez les fonctions payantes qu'après réception d'un webhook signé valide. Les IDs d'événements et leur ordre sont contrôlés côté serveur.

### OAuth, email et push

Pour Google et Trustpilot, l'URL de retour est **`APP_URL/api/connections/oauth/callback`**, à déclarer exactement dans chaque console. Chaque client sélectionne ses propres comptes et fiches Google ou renseigne son Business Unit Trustpilot dans son écran Connexions après autorisation OAuth. Renouvellement de jetons et stockage AES-256-GCM sont intégrés ; une rotation de clé de chiffrement sans migration exige de reconnecter les comptes.

L'email entrant requiert une passerelle dédiée ; ce n'est pas un webhook Resend natif. La passerelle authentifie l'expéditeur d'origine avant de signer le JSON attendu. Format, signature et limites : [docs/providers.md](docs/providers.md). Un simple transfert de mail non authentifié n'est pas accepté.

```bash
npx web-push generate-vapid-keys
```

L'utilisateur doit autoriser les notifications depuis son compte, dans un navigateur compatible et sur HTTPS. Les abonnements push sont propres à chaque navigateur. Le worker respecte les préférences email/push ; les notes inférieures à 3,3/5 déclenchent une alerte prioritaire.

## Campagnes, fidélité et parrainage

Import CSV avec `email,name,consent,consentSource` ; `consent=true` est obligatoire, les téléphones SMS sont au format E.164. Tous les contacts admissibles reçoivent une invitation neutre, sans sélection selon une note et avec désinscription. Une désinscription est revérifiée juste avant l'envoi. Voir [docs/campaigns.md](docs/campaigns.md).

La fidélité accorde 10 % pour une prochaine visite, indépendamment de tout avis. Codes aléatoires, usage unique par client, référence d'achat unique, expiration et consommation atomique limitent les abus. La preuve d'achat repose sur la validation du commerçant ; il n'existe pas d'intégration caisse ni de garantie d'identité universelle. Les avis externes ne peuvent pas être rendus uniques par Trusteo.

Le worker utilise des clés d'idempotence Resend stables ; après 23 heures d'incertitude, il demande une vérification manuelle. Un envoi SMS dont le résultat est inconnu reste `delivery_unknown`, sans renvoi automatique risquant un doublon. Les push suivent une livraison au moins une fois, regroupée par avis côté navigateur.

## Vérifications

```bash
npm run typecheck
npm test
npx playwright install chromium
# Utiliser une base de test dédiée migrée, jamais la production.
E2E_DATABASE_URL=postgresql://... npm run test:e2e
# Si Chromium est fourni par le système :
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium E2E_DATABASE_URL=postgresql://... npm run test:e2e
npm run build
npm start
```

`npm run build` prépare le standalone et y copie `public` et les ressources statiques via [scripts/prepare-standalone.mjs](scripts/prepare-standalone.mjs). `npm start` exécute ensuite ce serveur ; le worker reste un processus séparé.

Les tests Playwright lancent un serveur sur le port 3100 et contrôlent le rendu à 375 px. Les API externes sont désactivées dans ces tests navigateur. Les tests d'intégration HTTP simulés ne valident pas un débit bancaire, un vrai envoi ni une publication sur une plateforme. Consultez le [rapport de validation](docs/validation.md) et [docs/security-audit.md](docs/security-audit.md) pour les validations exécutées et les limites restantes. La construction Docker web et worker, un contrôle HTTP du web standalone et un job BullMQ réel contre PostgreSQL/Redis ont été vérifiés lors de la préparation initiale ; les relances sur la dernière révision sont distinguées dans le rapport de livraison. Aucun score Lighthouse ou audit WCAG exhaustif n'est présumé.

## Site public Lovable

La [checklist de liaison](docs/relier-lovable-checklist.md) couvre le déploiement Vercel, les accès nécessaires et la génération des liens avec `npm run lovable:links`. Le projet Lovable et son dépôt ne sont pas modifiés automatiquement.

Le site public est `https://trus-teo.lovable.app`. Le [guide Lovable et Stripe](docs/lovable-stripe.md) explique comment le relier à cette application Next.js après déploiement, où placer les clés serveur et quels IDs de tarifs fournir. Aucune liaison ou publication n’est présumée effectuée.

## Migrations et déploiement

`npm run db:migrate` exécute [scripts/migrate.mjs](scripts/migrate.mjs) : migrations SQL versionnées, transaction PostgreSQL, verrou consultatif et registre SHA-256. Ne modifiez jamais une migration appliquée. N'utilisez pas `prisma migrate deploy` en parallèle : son registre est différent. Cette solution contourne un défaut constaté d'introspection du moteur WASM Prisma (`name` PostgreSQL non pris en charge), sans désactiver une vérification TLS ou de signature. Prisma Client utilise son adaptateur PostgreSQL JavaScript, sans moteur de requêtes natif.

Déploiement web Vercel + PostgreSQL/Redis managés et worker permanent séparé : [docs/deployment.md](docs/deployment.md). Les pages légales sont des modèles à compléter avec l'identité de l'exploitant. Le registre RGPD, les décisions et les limites doivent être relus avant ouverture commerciale.
