# Déploiement et exploitation Trusteo

Le web et le worker sont deux processus distincts. PostgreSQL conserve comptes, consentements, abonnements et avis ; Redis transporte les jobs. Les transports externes nécessitent vos comptes réels. Cette documentation ne constitue pas une validation en production des comptes Stripe, Google, Trustpilot, email ou SMS.

## Préparer les services

1. Créer PostgreSQL managé avec sauvegardes, restauration testée, chiffrement et TLS vérifié. Utiliser une connexion directe pour les migrations, un pool compatible PrismaPg si nécessaire pour le web ; ne désactivez pas la validation des certificats. Définir une région européenne selon vos engagements RGPD.
2. Créer Redis avec persistance, authentification et TLS (`rediss://`) ; éviter une offre limitée à HTTP REST, incompatible avec BullMQ/ioredis. Configurer une politique d'éviction `noeviction`.
3. Choisir le domaine public et définir `APP_URL=https://votre-domaine`. Cette origine exacte est vérifiée sur toutes les mutations authentifiées.
4. Générer et conserver `CREDENTIAL_ENCRYPTION_KEY` hors Git. Web et worker doivent avoir la même clé. Une perte de cette clé rend les jetons OAuth existants inutilisables.
5. Configurer les quatre prix Stripe, le portail client et les webhooks décrits dans le README, dont `checkout.session.expired` pour libérer un checkout abandonné. Utiliser des clés de test jusqu'à validation complète, puis remplacer prix, clés et secret webhook ensemble.
6. Déclarer l'URL OAuth `/api/connections/oauth/callback` dans Google et Trustpilot ; obtenir leurs approbations API. Configurer Resend, le domaine expéditeur SPF/DKIM et DMARC, puis les clés OpenAI et VAPID. Les services de réception email et SMS restent facultatifs.

## Vercel : application web

Importer le monorepo. Choisir `apps/web` comme Root Directory et autoriser les fichiers hors de cette racine (paquet `packages/core`). Utiliser Node.js 24. Installer depuis la racine du dépôt pour conserver les workspaces et le lockfile :

- Install Command : `cd ../.. && npm ci`
- Build Command : `cd ../.. && npm run build`
- Output Directory : laisser celle du preset Next.js.

Toutes les variables serveur nécessaires vont dans les paramètres Vercel. Pour une liaison de secret dans le cloud géré, `TRUSTEO_OPENAI_API_KEY` est un alias accepté à la place de `OPENAI_API_KEY`, nom réservé par cette plateforme ; cette variable reste côté serveur. La clé publique VAPID est la seule valeur `NEXT_PUBLIC_*` ; les autres secrets restent côté serveur. `APP_URL` doit être correct **au build** pour les métadonnées et le sitemap ainsi qu'à l'exécution pour OAuth et CSRF. Les previews nécessitent leur propre origine et leurs propres URLs OAuth ; ne partagez pas les clés de production avec des previews non fiables.

Les migrations s'exécutent comme étape de release contrôlée, avec accès à la base cible, avant activation du nouveau code :

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run build
# Pour un hébergement Node autonome (hors Vercel) :
npm start
```

Le build prépare les ressources statiques et publiques du serveur standalone.

Ces commandes supposent un `.env` sécurisé à la racine pour le runner de migration, et le lien local `apps/web/.env` si les commandes Next doivent lire ce fichier. En CI où les valeurs sont injectées dans le processus, créer un fichier `.env` vide pour satisfaire `--env-file=.env` suffit ; les variables héritées conservent leur priorité. N'écrivez jamais les secrets dans un artefact ou des logs.

Le runner [scripts/migrate.mjs](../scripts/migrate.mjs) utilise un verrou consultatif, une transaction par migration et un registre de checksums. N'exécutez pas `prisma migrate deploy` en parallèle de ce registre. Les fichiers SQL initiaux proviennent du moteur de diff Prisma officiel ; cette voie évite un défaut d'introspection rencontré avec le moteur WASM. Pour une évolution du schéma : générer une **nouvelle** migration, relire le SQL, tester sur une copie de base, sauvegarder, appliquer puis déployer. Les changements destructeurs demandent une procédure de migration spécifique.

## Worker permanent

Déployer `apps/worker` sur un service de conteneurs ou de processus permanents (par exemple une VM ou une plateforme de workers), dans la région des données. Vercel n'héberge pas ce processus permanent.

```bash
# Depuis la racine du monorepo, après installation et génération Prisma :
node --import tsx apps/worker/src/index.ts
```

Injecter les mêmes `DATABASE_URL`, `REDIS_URL`, `APP_URL`, clé de chiffrement, OAuth, email et VAPID que pour le web. Ajouter Twilio si l'envoi SMS est activé. La commande sans `--env-file` fonctionne avec les variables du service ; pour le développement local, `npm run worker` charge le `.env` racine.

Le worker vérifie la connexion et le schéma PostgreSQL avant d'accepter les jobs. Il configure un dispatch toutes les 10 minutes, déclenche une passe au démarrage et traite trois files : `trusteo-sync`, `trusteo-notifications`, `trusteo-delivery`. Les connexions non API ne sont pas pollées. Les abonnements expirés n'autorisent pas de nouveau polling ni d'envoi. Un verrou Redis empêche deux synchronisations simultanées d'une connexion ; déduplication et journaux sont persistés en base.

Une reconnexion à Redis ou une restauration de snapshot ne suffit pas à redémarrer un processus : relancer explicitement web et worker après un redémarrage. Arrêter proprement avec SIGTERM ; les workers terminent leurs jobs en cours et ferment les connexions.

## Images Docker

Depuis la racine :

```bash
docker build --target web --build-arg APP_URL=https://votre-domaine -t trusteo-web .
docker build --target worker -t trusteo-worker .
# Le fichier de variables doit utiliser des hôtes managés accessibles aux conteneurs.
docker run --rm --env-file .env.production -p 3000:3000 trusteo-web
docker run --rm --env-file .env.production trusteo-worker
```

Les images excluent `.env`, les credentials et les rapports de test. L'image web utilise Next standalone et s'exécute sous un utilisateur non privilégié. L'image worker garde le code TypeScript et son runtime `tsx` ; elle ne lance ni le serveur web ni une migration automatiquement.

Dans l'environnement cloud géré, garder le proxy et la vérification TLS. Le Dockerfile accepte un certificat de proxy public via secret BuildKit, sans le conserver dans l'image :

```bash
docker build --target web --secret id=proxy_ca,src="$CODEX_PROXY_CERT" \
  --build-arg APP_URL=https://votre-domaine -t trusteo-web .
```

Pour exécuter un conteneur derrière le proxy de la session, monter le même certificat en lecture seule et définir `NODE_EXTRA_CA_CERTS` vers son chemin monté, comme décrit par la compétence runtime. Les variables proxy seules n'installent pas la chaîne de confiance. Un refus de destination requiert sa configuration réseau, jamais un contournement ou une désactivation TLS. Le Compose fourni vise un poste de développement avec confiance publique standard ; un environnement à proxy doit transmettre les secrets de build et la CA de runtime via une surcharge Compose locale.

## Réseau sortant

Configurer uniquement les destinations utilisées : registres npm pour installer ; `api.stripe.com`, `api.openai.com`, `api.resend.com`, `accounts.google.com`, `oauth2.googleapis.com`, `mybusinessaccountmanagement.googleapis.com`, `mybusinessbusinessinformation.googleapis.com`, `mybusiness.googleapis.com`, `authenticate.trustpilot.com`, `api.trustpilot.com`, ainsi que `api.twilio.com` pour SMS. Les destinations push dépendent du navigateur : `fcm.googleapis.com`, `*.push.services.mozilla.com`, `web.push.apple.com`, `*.notify.windows.com`. Les services managés PostgreSQL/Redis nécessitent leurs propres autorisations TCP et DNS. Une allowlist HTTPS ne garantit pas l'accès TCP.

## Exploitation, reprises et RGPD

- Surveiller les jobs en échec, les journaux `SyncLog`, les quotas des plateformes, l'âge du dernier polling, les rebonds/désinscriptions et les erreurs Stripe webhook. Ne pas enregistrer de jetons ni de corps email/avis dans les logs techniques.
- Les notifications forment un outbox durable en base. Resend utilise une clé d'idempotence stable ; une opération incertaine de plus de 23 heures nécessite une vérification manuelle avant renvoi. Pour SMS, vérifier `delivery_unknown` dans Twilio avant toute intervention. Ne pas remettre ces statuts à `pending` sans rapprochement.
- Le statut `completed_with_errors` signale une campagne terminée avec des échecs ou résultats inconnus. Les contacts désinscrits sont exclus au moment réel de l'envoi.
- Vérifier les restaurations PostgreSQL avec la clé de chiffrement correspondante. Conserver Redis ou laisser le dispatcher reconstruire les opérations de l'outbox ; les envois externes doivent être rapprochés avant tout renvoi.
- Compléter les mentions légales, CGV, politique de confidentialité, contrats sous-traitants et le registre des traitements. Tester export et suppression des données et définir une politique de rétention opérationnelle. Le compte doit arrêter son abonnement via le portail avant suppression pour éviter des prélèvements orphelins.
- Faire relire le contenu légal et contrôler les permissions/quotas API. Effectuer un audit WCAG et Lighthouse sur le domaine final, ainsi que de véritables tests Stripe en mode test, emails, push et autorisations Google/Trustpilot avant ouverture commerciale.

Pour les appels HTTPS depuis un conteneur dans ce cloud, les options de build ne suffisent pas : monter aussi le certificat public au démarrage, définir `NODE_EXTRA_CA_CERTS` vers ce montage et `NODE_USE_ENV_PROXY=1`, en conservant les paramètres proxy hérités. Aucun certificat de session ni secret ne doit être copié dans une couche d’image.
