# Relier Lovable à l'application Trusteo

Site public : https://trus-teo.lovable.app.

Ce guide concerne la liaison du site existant au serveur Next.js de ce dépôt. Une URL publique Lovable ne donne pas d’accès en écriture au projet. Les quatre boutons de tarifs utilisent désormais les Payment Links directs : voir [le texte Lovable](lovable-paiements-prompt.md). Les liens de compte et le traitement sécurisé des abonnements nécessitent toujours un serveur déployé.

## 1. Héberger l'application

Dans Vercel, importer le dépôt GitHub `lostcontactpro-ux/TRUSTEO` et choisir la branche de préparation `codex/trusteo-lovable-integration` tant que les changements n'ont pas été intégrés à la branche de production voulue.

- Root Directory : **apps/web** ; autoriser les fichiers du monorepo hors de cette racine.
- Node.js : **24.x**.
- Le fichier [apps/web/vercel.json](../apps/web/vercel.json) définit l'installation, le build et le dossier `.next`.
- Ne pas importer uniquement une copie de `apps/web` : le dossier `packages/core`, le lockfile et les outils de build à la racine sont nécessaires.

Renseigner dans les paramètres sécurisés du serveur `DATABASE_URL` (PostgreSQL managé), `REDIS_URL` (Redis TCP, pas REST), `CREDENTIAL_ENCRYPTION_KEY` et `APP_URL` (origine HTTPS réelle de cette application). Les conteneurs locaux de l'environnement de développement ne sont pas une base de production accessible depuis Vercel.

Appliquer les migrations avec les variables injectées dans un environnement de release qui peut joindre PostgreSQL :

```sh
npm ci
npm run db:generate
npm run db:migrate:deploy
```

Le registre SHA256, les transactions et le verrou PostgreSQL sont conservés. Cette commande n'exige pas de fichier `.env` en CI. Ne pas exécuter les migrations contre une autre base par défaut ou mélanger ce registre avec `prisma migrate deploy`.

Le worker BullMQ est un service permanent séparé, avec accès aux mêmes services managés. Le déployer selon [deployment.md](deployment.md). Ajouter les identifiants Stripe, email et OAuth dans les paramètres serveur pour activer ces fonctionnalités, sans les transmettre dans le chat ni les placer dans le site public.

## 2. Vérifier le serveur avant de modifier Lovable

- Le site, les pages `/signup` et `/login` doivent répondre sur l'adresse HTTPS de l'application.
- Tester une véritable inscription et reconnexion, puis le chargement du profil : un accueil public ou un HTTP 401 sans session ne prouve pas l'accès à la base.
- Vérifier le domaine `APP_URL`, le worker et les migrations. Les webhooks Stripe et retours Google/Trustpilot doivent utiliser l'origine de l'application, pas celle du site public Lovable.
- Le build inclut explicitement le compilateur WASM Prisma. Après un build local, `npm run test:standalone` vérifie un artefact copié hors du dépôt, avec inscription et profil sur PostgreSQL local uniquement. Il ne valide pas un compte Vercel ou une base managée.

## 3. Générer les boutons et le prompt Lovable

Avec la véritable adresse déployée de l'application :

```sh
npm run lovable:links -- "$TRUSTEO_DEPLOYED_ORIGIN"
```

`TRUSTEO_DEPLOYED_ORIGIN` désigne ici la variable contenant cette adresse, pas une URL à inventer. Le script ne lit aucun secret et ne déploie rien. Il produit les destinations d’inscription, connexion et devis vers l’application, les quatre tarifs vers Stripe, puis une consigne prête à coller dans Lovable. Le mode `--json` donne le même contenu structuré. La validation est syntaxique ; elle ne prouve pas la disponibilité du serveur. Pour générer uniquement les tarifs et le texte sans URL d’application : `npm run lovable:links -- --payments-only`.

L'opérateur peut appliquer cette consigne dans son projet Lovable. Pour modifier directement le code du site, fournir le lien du **dépôt GitHub relié au projet Lovable** et l'accès correspondant ; il peut être différent du dépôt de cette application.

## 4. Confirmer la liaison réelle

Depuis https://trus-teo.lovable.app, tester les boutons du menu, de l'accueil et des tarifs, sur mobile :

- Essayer → inscription sur l'application ; Connexion → connexion sur l'application.
- Essentiel/Pro et mensuel/annuel ouvrent les quatre Payment Links exacts ; l’annuel annonce le paiement immédiat sans essai.
- Les formulaires de compte restent sur l’application, le paiement sur Stripe, sans iframe ni appels authentifiés interdomaines depuis Lovable.
- Un abonnement confirmé par webhook ouvre les fonctionnalités ; une simple redirection de paiement ne suffit pas.

La liaison n'est terminée qu'après ces vérifications sur les vrais domaines. La présence des fichiers dans GitHub ou une configuration Vercel prête ne constitue pas une publication du site ni une modification de ses boutons.
