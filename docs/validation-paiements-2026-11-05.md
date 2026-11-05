# Validation des paiements directs — 5 novembre 2026

## Résultats locaux

| Vérification | Résultat |
| --- | --- |
| `npm test` | 323 tests réussis, 31 fichiers |
| `npm exec vitest run -- --config tests/e2e/vitest.webhook.config.ts` | 9 tests réussis ; vraie vérification de signature, transport Stripe et persistance simulés |
| Playwright Chromium à 375 px | 16 scénarios validés ; les 5 nouveaux cas de facturation ont été relancés et passent après correction d’un sélecteur du test |
| `npm run typecheck` | Web et worker valides |
| `npm run build` | Build de production et artefact standalone générés |
| `npm run test:standalone` | Artefact copié hors du dépôt : WASM Prisma présent, vraie inscription PostgreSQL locale, cookie Secure/HttpOnly et profil authentifié ; fixture supprimée |
| Migration `20261105160000_payment_receipts` | Appliquée à PostgreSQL local ; pas à une base de production |
| Diff et fichiers livrés | `git diff --check` valide ; aucun jeton Vercel ou clé OpenAI de projet détecté dans les fichiers versionnés/à ajouter |

Les cinq nouveaux scénarios navigateur vérifient les quatre destinations Stripe, les économies et l’absence d’essai annuel ; la cadence annuelle à l’inscription ; la confirmation d’annulation avec case seule inerte ; le rattachement sans deuxième Checkout ; et une course réelle sur PostgreSQL où deux abonnements partageant une carte ne reçoivent qu’un essai. Le dernier scénario vérifie aussi que supprimer le compte n’efface pas la preuve anti-abus. Les appels financiers et emails externes des parcours navigateur restent isolés.

Les tests du backend couvrent notamment les prix/cadences/quantités non autorisés, le refus d’un reçu appartenant à un autre email, les jetons expirés ou consommés, les événements antérieurs au compte, l’échec d’envoi, les courses de rattachement, les essais annuels invalides annulés sans facture, le coupon non réinitialisé, les reprises payantes après refus d’essai et les refus CSRF d’annulation.

## Limites opérationnelles

- Aucun paiement bancaire réel n’a été effectué, aucun abonnement marchand réel annulé. La clé secrète Stripe et le service Resend ne sont pas disponibles ici.
- Les quatre URLs ont été reprises exactement de la demande. Leur activation, leurs prix effectifs, leur mode test/réel et leurs réglages d’essai distants ne sont pas vérifiés. Le script `stripe:links` prépare leur contrôle puis leur configuration avec la clé adéquate.
- Aucun accès d’édition au projet Lovable n’est fourni par son URL publique. Le dépôt contient les boutons modifiés et un [prompt à appliquer dans Lovable](lovable-paiements-prompt.md), sans prétendre avoir édité le site distant.
- Pas de déploiement public ni de base managée créé par cette livraison. Le serveur, le webhook, Resend et le worker doivent être configurés avant l’encaissement public.
- La protection anti-essais réduit les identités connues ; elle ne prouve pas l’unicité d’une personne utilisant de nouvelles cartes et adresses.

Les rapports précédents dans [validation.md](validation.md) décrivent leurs versions historiques. La configuration actuelle des paiements est décrite dans [paiements-directs.md](paiements-directs.md).
