# Décisions Trusteo

- Nom public : **Trusteo** (remplace Testeo).
- Monorepo npm workspaces, Next.js App Router, TypeScript strict, PostgreSQL/Prisma, worker BullMQ/Redis séparé : Vercel héberge le web, pas un worker permanent.
- Utiliser le checkout isolé existant ; ne pas créer de worktree sans demande explicite.
- Aucun faux avis, achat d'avis, scraping interdit ou filtrage par satisfaction. Une note < 3,3/5 déclenche une priorité de traitement, jamais de nouveaux avis artificiels.
- Parrainage et fidélité : remise 10 % liée à une visite/achat vérifié, utilisable une fois par client. Jamais conditionnée au dépôt d'un avis, à son unicité ou à sa note ; les plateformes peuvent interdire toute incitation aux avis.
- Les services tiers exigent les propres comptes et autorisations de l'exploitant. Aucun mode démonstration ne doit prétendre avoir effectué un paiement, envoyé un message ou publié un avis réel.
- Pro : jusqu'à 20 établissements, Essentiel : jusqu'à 3. Le seuil de 3 pour Pro est un positionnement commercial, pas une obligation de créer 3 établissements.
- Entreprise : devis et plafond accordé explicitement côté serveur, aucune limite infinie implicite.
- Textes juridiques et témoignages exemples : brouillons identifiés, à personnaliser avant production.
- Auth : sessions opaques aléatoires, hachées en PostgreSQL plutôt qu'Auth.js. Cookies HttpOnly/SameSite, contrôle strict Origin pour CSRF, bcrypt12 et révocation lors d'un reset. Compteurs de débit atomiques PostgreSQL partagés entre instances.
- Prisma 6.19.3 : client sans moteur natif avec pilote officiel PrismaPg, moteur de schéma WASM via prisma.config.ts (option adapter expérimentale). Le moteur natif est bloqué par le réseau cloud. Le WASM génère le SQL initial correctement mais `migrate deploy` échoue sur le type interne PostgreSQL `name`. `scripts/migrate.mjs` applique donc les SQL Prisma dans une transaction, avec verrou consultatif et registre SHA256. Ne pas mélanger ce registre avec `prisma migrate deploy` sans reprise explicite.
- Inter est distribuée localement, aucune requête Google Fonts.
- Remise d'introduction Stripe : uniquement deux mensualités ; les forfaits annuels ont déjà leur tarif spécifique. L'essai n'est accordé qu'après webhook Stripe signé, jamais sur simple inscription.
- Email d'avis entrants : passerelle HMAC documentée, à brancher à un domaine détenu et à une vérification DKIM/ARC ; le parseur refuse les formats inconnus, sans inventer de note ni d'auteur.
- Campagnes : salutations approuvées et invitation neutre imposée, consentement et désinscription vérifiés de nouveau au moment de l'envoi. Aucun ciblage selon note/satisfaction.
- Fidélité : une remise par client pour cette première version, 90 jours d'expiration ; la référence d'achat est attestée par le commerçant, sans prétendre vérifier une caisse non connectée.
- Notifications : email idempotent avec fenêtre conservatrice de 23h ; au-delà, rapprochement manuel pour éviter les doublons. SMS à statut incertain mis en quarantaine. Push au moins une fois avec regroupement par avis côté navigateur.
- Publier une réponse assistée ne marque jamais l'avis comme répondu. La copie et l'ouverture de la plateforme restent sous contrôle du gérant.

- Renouvellement OAuth : verrou de ligne PostgreSQL partagé entre le web et le worker, relecture des jetons sous verrou et conservation des identifiants de ressource validés.
- Outillage : Prisma CLI est une dépendance de développement à la racine du monorepo ; override deepmerge-ts 8 pour corriger son avis de sécurité, validé par génération et build. Vitest 5 remplace la version initiale vulnérable.

- Connexions SaaS : l'exploitant enregistre l'application OAuth Trusteo une seule fois. Chaque entreprise cliente autorise ses propres comptes Google/Trustpilot depuis son interface ; aucun compte de commerçant partagé ni collecte de mots de passe. Les autorisations et jetons sont isolés par connexion et établissement du client.

- Connecter mon entreprise : un identifiant de fiche n'est jamais une autorisation. Google utilise OAuth ; les clés API sont proposées uniquement pour les transports qui les prennent en charge (Trustpilot en lecture seule).
- Activation : test de fiche et d'avis en lecture seule, aperçu réel limité à trois avis, attestation explicite et reçu serveur chiffré à usage unique valable dix minutes. Le test ne publie rien et ne valide pas artificiellement l'IA ou les notifications. Une clé publique ne prouve pas la gestion de l'entreprise.
- Les anciennes connexions API doivent être confirmées avant reprise du polling et de la publication. Une connexion active testée à nouveau conserve ses paramètres jusqu'à validation ; une nouvelle autorisation OAuth exige un nouvel aperçu.
