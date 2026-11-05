# Relier le site Lovable à Trusteo et Stripe

Site public fourni par l'exploitant : **https://trus-teo.lovable.app**.

Le projet livré dans ce dépôt est une application Next.js avec routes serveur, Prisma/PostgreSQL et worker Redis. Il n'est pas automatiquement présent dans le projet Lovable et n'a pas encore été déployé sur Vercel. Une URL publique Lovable n'accorde pas d'accès en écriture à son projet.

## Répartition proposée avec le code livré

- **Lovable** conserve le site public, ses contenus et ses tarifs.
- **L'application Trusteo**, hébergée sur un serveur compatible Next.js tel que Vercel, gère inscription, connexion, espace client, consentements Google/Trustpilot et facturation. Une URL Vercel provisoire peut servir avant l'achat d'un domaine.
- **Stripe** encaisse les abonnements des utilisateurs de Trusteo sur le compte Stripe de l'exploitant. Les restaurateurs ne connectent pas leur propre compte Stripe pour payer leur abonnement. Ce flux ne nécessite pas Stripe Connect.
- PostgreSQL, Redis et le worker restent ceux de l'application. Un simple lien depuis Lovable ne remplace pas ces services.

Conserver les formulaires de compte dans l’application. Les boutons tarifaires ouvrent directement les quatre Payment Links Stripe ; le paiement est ensuite rattaché au compte par une preuve envoyée à son email. Les liens de compte ouvrent l’application : ne pas envoyer de requêtes authentifiées interdomaines ni supprimer les protections CSRF. Guide actuel : [paiements-directs.md](paiements-directs.md), avec [texte prêt à coller dans Lovable](lovable-paiements-prompt.md).

Si l'objectif est d'héberger toute l'application dans le projet Lovable existant, inspecter d'abord son code et ses capacités d'exécution, puis préparer une adaptation dédiée. Ne pas présenter le monorepo Next.js comme déjà importé dans Lovable.

## Préparer Stripe

1. Activer le compte Stripe de l'entreprise, compléter les vérifications et renseigner l'IBAN dans le tableau de bord Stripe. Ces informations restent chez Stripe et ne sont pas demandées dans le chat.
2. Commencer en mode test. Créer les quatre prix récurrents EUR :

| Variable serveur | Tarif | Identifiant à relever |
| --- | --- | --- |
| `STRIPE_PRICE_ESSENTIAL_MONTH` | Essentiel, 49,80 €/mois | `price_…` |
| `STRIPE_PRICE_ESSENTIAL_YEAR` | Essentiel, 409 €/an | `price_…` |
| `STRIPE_PRICE_PRO_MONTH` | Pro, 109 €/mois | `price_…` |
| `STRIPE_PRICE_PRO_YEAR` | Pro, 980 €/an | `price_…` |

Les quatre IDs `price_…` peuvent être transmis pour configuration. Un ID de produit `prod_…` ou de compte `acct_…` seul ne suffit pas à créer les abonnements prévus. Tous les IDs et les clés doivent appartenir au même compte et au même mode Stripe.

3. Renseigner `STRIPE_SECRET_KEY` dans les variables sécurisées **du serveur de l'application Trusteo**, jamais dans le code du site public ni dans le chat. Le flux Checkout hébergé du projet ne nécessite pas de clé secrète dans le navigateur.
4. Après déploiement, enregistrer `URL_APPLICATION/api/billing/webhook` dans Stripe et placer son secret `whsec_…` dans `STRIPE_WEBHOOK_SECRET`. `URL_APPLICATION` est ici un repère à remplacer par la véritable origine HTTPS déployée. Événements :
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.expired`
5. Activer le Customer Portal pour les moyens de paiement, factures et annulations. Vérifier les contraintes de changement de formule décrites dans le README.
6. Tester inscription → Stripe Checkout → carte de test → webhook → essai actif → espace client. Les IDs et une redirection de succès ne suffisent pas : l'accès est accordé par le webhook signé. Le passage en mode réel nécessite les clés et prix du mode réel, puis une validation distincte.

L’application impose la carte. Seuls les nouveaux clients mensuels admissibles bénéficient de 14 jours d’essai et de 20 % sur deux mensualités ; le registre anti-abus contrôle email et carte. L’annuel est payé immédiatement, sans essai ni cumul avec le coupon. Le code crée le coupon attendu si la clé Stripe le permet ; sinon configurer `STRIPE_INTRO_COUPON_ID`. Les réglages distants des Payment Links doivent être vérifiés séparément : `npm run stripe:links -- --check`, puis `--apply` après préparation du serveur et des emails.

## Relier les boutons dans Lovable

Une fois l'application réellement déployée, remplacer `URL_APPLICATION` par son origine HTTPS sans slash final :

| Bouton du site public | Destination |
| --- | --- |
| Essayer / Commencer | `URL_APPLICATION/signup` |
| Connexion / Mon espace | `URL_APPLICATION/login` |
| Essentiel mensuel | https://buy.stripe.com/14A3cv2Fn5Up4ssg3Zes004 |
| Essentiel annuel | https://buy.stripe.com/eVqfZh4Nv1E95ww3hdes002 |
| Pro mensuel | https://buy.stripe.com/14AdR9gwdfuZbUU8Bxes003 |
| Pro annuel | https://buy.stripe.com/6oUbJ193L4Qlf765ples001 |
| Entreprise sur devis | `URL_APPLICATION/contact` |

Consigne à fournir à Lovable après remplacement de ce repère :

> Conserve mon site public et son design. Relie les quatre formules aux Payment Links Stripe exacts du tableau. L’annuel est sans essai et payé en une fois. Relie les liens de compte à l’application existante. Ne crée pas un deuxième système d’authentification ou de facturation et n’ajoute aucune clé secrète Stripe dans le navigateur.

Configurer `APP_URL` sur le serveur avec **l'origine de l'application**, puis les callbacks Google/Trustpilot vers `URL_APPLICATION/api/connections/oauth/callback`. Ne pas utiliser l'URL Lovable pour les webhooks et callbacks de ce dépôt tant que ces routes serveur n'y sont pas effectivement hébergées.

Chaque commerce autorise ses propres comptes Google et Trustpilot dans l'application ; l'exploitant configure uniquement les identifiants OAuth de l'application Trusteo. Voir [providers.md](providers.md).
