# Audit de sécurité et limites de validation

Audit de développement du 3 novembre 2026. Ce document décrit la portée du contrôle du code et des tests ; ce n’est ni un pentest externe ni une certification WCAG/RGPD.

## Contrôles présents

| Surface | Mesures |
| --- | --- |
| Authentification | Mots de passe bcrypt coût 12, minimum 12 caractères et maximum 72 octets ; erreur de connexion générique ; jetons de session aléatoires 256 bits, seul SHA-256 stocké ; cookie HttpOnly, SameSite=Lax, Secure en production ; expiration des sessions. |
| Réinitialisation | Jeton aléatoire, empreinte seule en base, expiration 30 minutes, consommation atomique et révocation des sessions. Envoi uniquement via Resend configuré. |
| CSRF | Origine exacte APP_URL et JSON exigés pour les mutations authentifiées ; rejet des requêtes cross-site. Les webhooks utilisent leur signature, pas une session navigateur. |
| Isolation | Propriété utilisateur vérifiée dans les requêtes d’établissements, campagnes, contacts et avis ; export limité au propriétaire ; secrets de connecteurs exclus de l’export. |
| Limites | Compteurs PostgreSQL partagés entre instances ; création d’établissement sérialisée par verrou utilisateur et limite de plan serveur ; aucune activation d’essai à la seule inscription ; au-delà du plafond après rétrogradation, les opérations facturables sont suspendues jusqu’à suppression des établissements en trop ou changement de formule. Lecture et suppression restent disponibles. |
| Paiement | Checkout hébergé Stripe, carte obligatoire ; aucune carte ne traverse Trusteo. Tarifs vérifiés côté serveur, webhook signé avec contrôle temporel, déduplication et transaction ; un échec de persistance produit une erreur réessayable. |
| Campagnes | Consentement explicite et provenance, invitations neutres identiques, exclusion des désinscrits ; une réimportation ne réactive pas un désinscrit ; GET de désinscription sans effet pour éviter les scanners d’emails. |
| Fidélité | Remise indépendante de tout avis ; achat attesté par le commerçant ; unicité client/achat ; code aléatoire, expiration et consommation atomique. Cette attestation n’est pas une vérification automatique de caisse ou d’identité. |
| Réputation | Aucun faux avis ni scraping. Note < 3,3/5 : priorité de réponse uniquement. Les suggestions IA nécessitent une validation humaine ; le mode assisté ne marque jamais une copie comme publication réussie. |
| Navigateur | React échappe les textes ; nosniff, Referrer-Policy, interdiction d’iframe et permissions minimales. Secrets réservés au serveur. |

## Tests reproductibles

```sh
npm test
npx vitest run --config tests/e2e/vitest.webhook.config.ts
npm run test:e2e
```

Le test de webhook utilise la **vraie vérification de signature Stripe**, avec une récupération Stripe et une persistance remplacées par des doublures. Six scénarios ont été exécutés avec succès : activation signée, livraison doublonnée, signatures invalides/expirées, prix inconnu, événement ancien et expiration de Checkout. Il ne réalise aucun paiement et ne remplace pas un test Stripe en mode test avec de vraies clés.

Les tests Playwright utilisent des comptes uniques `e2e-…@example.test` et suppriment exclusivement leurs propres utilisateurs par identifiant à la fin. Aucune remise à zéro de la base n’est effectuée. Utiliser `E2E_DATABASE_URL` pour une base de test dédiée ; à défaut ils utilisent la base de développement. Ne jamais les lancer sur une base de production.

Le parcours navigateur à 375 px inscrit réellement un compte, vérifie l’absence de droit avant paiement, injecte **explicitement une fixture d’essai en base**, se reconnecte puis copie une réponse assistée. Le Checkout externe est isolé dans ce test : ce parcours ne prouve pas le paiement Stripe. Les autres tests contrôlent CSRF, isolation entre deux comptes, limites, consentement, désinscription, codes à usage unique et services externes absents. Les clés Stripe/OpenAI/Resend sont vidées dans le serveur Playwright pour éviter tout envoi ou débit externe. Exécuter sans `E2E_REUSE_SERVER` garantit ce profil de test.

## Éléments restant à valider avant production

- Désactiver le changement de formule dans le Customer Portal Stripe : conserver annulation et moyens de paiement. Une rétrogradation réalisée manuellement qui laisse trop d’établissements suspend les opérations facturables ; aucune donnée n’est supprimée automatiquement.
- Configurer de vraies clés en mode test, puis vérifier Stripe Checkout avec carte, webhook, deux factures mensuelles remisées, annulation et renouvellement. Le forfait annuel ne reçoit pas la remise mensuelle.
- Valider OAuth et publication avec des comptes Google/Trustpilot autorisés. Les approbations partenaires et quotas des plateformes ne peuvent pas être obtenus par le code.
- Configurer le domaine email (SPF/DKIM/DMARC), les webhooks entrants, VAPID et les autorisations push sur les navigateurs ciblés. Tester la distribution effective des messages.
- Héberger le worker permanent séparément de Vercel, protéger Redis/PostgreSQL par authentification et TLS, surveiller les échecs et conserver des sauvegardes avec une rétention définie.
- Renseigner l’identité légale de l’exploitant, les CGV, la politique de conservation et les contrats de sous-traitance. Le registre RGPD est un point de départ, pas une validation juridique.
- Les emails utilisateurs ne sont pas vérifiés à l’inscription ; MFA et protection avancée contre les inscriptions automatisées ne sont pas inclus. Les limites globales actuelles doivent être adaptées au trafic réel et complétées au niveau de l’hébergeur.
- La CSP autorise encore `unsafe-inline` pour le rendu Next.js ; envisager une stratégie de nonces avant de traiter des besoins de sécurité renforcés. Ne pas assimiler cette politique à une élimination de tout risque XSS.
- La suppression du compte est refusée tant qu’un Checkout reste associé (jusqu’au webhook signé `checkout.session.expired` ou à sa confirmation) et nécessite d’abord l’annulation de l’abonnement Stripe pour éviter des prélèvements orphelins. Définir séparément la rétention légale des factures et la suppression des sauvegardes ; la suppression en base ne révoque pas automatiquement les consentements OAuth chez les fournisseurs.
- L’unicité de la fidélité concerne les identifiants/email enregistrés, pas une personne physique prouvée. Le commerçant doit vérifier l’achat et les abus multi-identités ; aucune analyse d’avis ni dépôt d’avis n’est utilisé pour déclencher une remise.
- Lighthouse > 90 et conformité WCAG AA complète nécessitent des mesures sur une version de production représentative. Les contrôles de viewport, focus et formulaires n’autorisent pas à annoncer ces objectifs comme déjà certifiés.

## Signalement des résultats

Distinguer les tests unitaires, le navigateur local avec fixtures, les intégrations réelles et la publication. Une intégration nécessitant une clé absente doit rester indiquée comme non testée. Un code copié dans le presse-papiers n’est pas une réponse publiée. Aucune fixture synthétique n’est envoyée vers une plateforme d’avis.

## Réduction et essai : hypothèses de facturation

Le SDK Stripe installé définit un coupon `repeating` par une durée en mois calendaires, et non par un compteur de factures. Avec l’essai fixé à 14 jours et une échéance mensuelle inchangée, les deux premières factures sont émises à la fin de l’essai puis un mois plus tard ; elles arrivent avant l’expiration des deux mois du coupon. La troisième arrive après. La remise couvre ainsi deux factures mensuelles ordinaires, pas deux mois d’essai. Ne pas prolonger manuellement l’essai ni modifier l’ancrage de facturation sans revalider cette règle. Les proratas, changements de formule et ajustements manuels doivent être vérifiés avec Stripe Test Clocks avant leur ouverture aux clients. La simulation de ces factures réelles reste non exécutée sans clés Stripe.

## Résultats locaux finaux

95 tests métier/sécurité, 6 tests du webhook et 8 parcours Chromium à 375 px passent. L’audit npm du lockfile final ne signale aucune vulnérabilité connue. Le verrou PostgreSQL de renouvellement OAuth et la relecture des jetons sérialisent les refresh entre web et worker. Les scores Lighthouse et le périmètre exact sont consignés dans [validation.md](validation.md).
