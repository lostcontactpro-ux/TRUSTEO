# Validation Trusteo — 3 novembre 2026

Contrôles exécutés dans l'environnement cloud sur le checkout `/workspace/TRUSTEO`. Les résultats locaux ne constituent pas une publication ni une validation des comptes de services externes.

| Contrôle | Résultat |
| --- | --- |
| Installation reproductible | `scripts/cloud-install.sh` relancé avec `npm ci` ; PostgreSQL/Redis prêts ; migrations déjà appliquées reconnues sans modification |
| TypeScript | Web et worker passent `npm run typecheck` |
| Tests métier et sécurité | 95 tests passent dans 15 fichiers Vitest |
| Webhook Stripe | 6 tests passent avec vérification HMAC réelle, récupération Stripe et persistance simulées |
| Navigateur à 375 px | 8 parcours Playwright passent sur Chromium système |
| Build de production | `npm run build` passe ; le standalone inclut les ressources publiques et statiques |
| Serveur standalone | 200 sur accueil, tarifs, connexion, manifest, sitemap et robots ; 401 sur le compte sans session |
| Worker réel | Démarrage sur PostgreSQL/Redis locaux et consommation d'un job `dispatch` confirmés |
| Docker final | Images web et worker construites ; pages, CSS, icône, manifest et refus d’accès sans session vérifiés dans l’image web sous UID 1000 ; Compose valide |
| Dépendances | `npm audit` : 0 alerte connue au moment de la vérification |
| Lighthouse mobile sur accueil de production local | Performance 99, accessibilité 100, bonnes pratiques 100, SEO 100 |

Les huit tests navigateur couvrent le site public FR/EN, les choix de tarifs, l'inscription en trois étapes, une **fixture explicite d'essai**, la reconnexion, la copie d'une réponse assistée, la sauvegarde du profil, l'isolation des comptes, CSRF, les plafonds et rétrogradations de plans, le consentement, la désinscription, la fidélité à usage unique, l'absence de clés et la suppression d'un compte avec paiement en cours. Aucun avis de test n'a été envoyé à une plateforme.

Le renouvellement OAuth est sérialisé par verrou PostgreSQL partagé entre web et worker. Les tests couvrent deux instances simultanées avec jeton expiré et deux erreurs 401 simultanées ; ils ne réalisent pas de consentement OAuth réel.

Lighthouse a été exécuté via `npm exec --package=lighthouse` contre le serveur standalone, avec Chromium local. Ce score concerne l'accueil dans ces conditions ; il ne certifie pas toutes les pages WCAG AA. Le cache retour navigateur est volontairement limité par les réponses `no-store` de pages dynamiques.

## Configuration cloud sauvegardée

Le brouillon contient le script complet `install_script`, les instructions `start_skill`, les domaines nécessaires et les exigences de clés Stripe, OpenAI et Resend, avec les variables d'OAuth, de tarifs et d'email. Les valeurs des secrets n'ont pas été inventées ni enregistrées dans le code. Dans le cloud géré, l'alias `TRUSTEO_OPENAI_API_KEY` évite le préfixe réservé `OPENAI_`.

Cette sauvegarde ne lance pas les scripts, ne renseigne pas les secrets, n'applique pas les nouveaux accès réseau et ne publie pas l'environnement. Relire et enregistrer les paramètres, renseigner les valeurs sécurisées puis publier l'environnement dans le produit.

## Vérifications externes restantes

- Stripe en mode test réel : carte, essai de 14 jours, deux factures remisées, renouvellement, portail et annulation.
- Google Business Profile et Trustpilot : approbations, OAuth et publication avec un établissement autorisé.
- OpenAI : disponibilité du modèle, qualité des trois tons, coût et données autorisées à transmettre.
- Resend/domaine, passerelle d'emails entrants, Web Push et SMS : distribution réelle et traitement des erreurs.
- Identité de l'exploitant, CGV, durées de conservation, sous-traitants et sauvegardes à finaliser avant ouverture commerciale.

Les autres plateformes exposent leurs modes email et assisté ; aucune API partenaire inaccessible n'est présentée comme opérationnelle. Le parrainage et les remises exigent une attestation d'achat du commerçant ; ils restent indépendants de tout avis.

## Historique et publication

Les dix étapes sont enregistrées dans des commits locaux. Aucun push GitHub ni déploiement Vercel n’a été effectué. La restauration de cet historique local dans une nouvelle tâche cloud n’a pas été vérifiée ; un bundle Git est fourni dans `/workspace/shared/trusteo-2026-11-03.bundle` pour conserver les sources et leur historique indépendamment du checkout.

## Évolution : Connecter mon entreprise

Le 3 novembre 2026, le parcours `/app/connections` a été complété avec test en lecture seule, aperçu de fiche/avis et confirmation explicite. Les checks de cette évolution sont distincts de la validation initiale ci-dessus :

- 136 tests unitaires passent dans 19 fichiers ; les 6 tests du webhook Stripe restent passants.
- 11 scénarios Playwright à 375 px passent, dont 3 nouveaux pour l'aperçu, le consentement, l'expiration et l'isolation de compte.
- TypeScript web/worker et le build de production passent.
- La nouvelle migration a été appliquée puis réexécutée sans changement. Le dispatcher réel PostgreSQL/Redis a supprimé un aperçu expiré de test en conservant l'entreprise inactive ; ses données de test ont été supprimées par identifiant.
- Le test visuel de connexion utilise des réponses de plateforme simulées. Les tests API réels refusent les jetons invalides et l'accès d'un autre propriétaire. Aucun consentement Google/Trustpilot réel ni publication d'avis n'est revendiqué.

Voir [Connecter mon entreprise](connect-my-business.md) et [portée des tests](testing-business-connection.md). Cette évolution n'a pas été publiée sur Lovable.
