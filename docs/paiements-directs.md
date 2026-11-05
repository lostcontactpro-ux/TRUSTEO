# Liens Stripe directs et abonnements

Les quatre liens fournis sont centralisés avec les tarifs dans `packages/core/src/pricing.ts`. L’accueil et `/pricing` ouvrent directement Stripe ; l’annuel est sélectionné par défaut. Le dépôt Next.js est modifié, pas le projet Lovable distant : copier [le texte Lovable prêt](lovable-paiements-prompt.md) dans le projet pour y appliquer les mêmes boutons.

| Offre | Lien de paiement | Prix | Économie annuelle |
| --- | --- | --- | --- |
| Essentiel mensuel | https://buy.stripe.com/14A3cv2Fn5Up4ssg3Zes004 | 49,80 €/mois | — |
| Essentiel annuel | https://buy.stripe.com/eVqfZh4Nv1E95ww3hdes002 | 409 €/an | 188,60 €, soit 31,6 % |
| Pro mensuel | https://buy.stripe.com/14AdR9gwdfuZbUU8Bxes003 | 109 €/mois | — |
| Pro annuel | https://buy.stripe.com/6oUbJ193L4Qlf765ples001 | 980 €/an | 328 €, soit 25,1 % |

Comparaison avec douze mensualités au tarif normal, hors remise de bienvenue. Les équivalents mensuels 34,08 € et 81,67 € sont indicatifs : Stripe prélève le montant annuel entier. L’annuel ne comporte **aucun essai gratuit** ni cumul avec la remise d’introduction mensuelle.

## Ce qui est livré

- Annuel actif : graphique sur 30, 90 ou 365 jours, comparaison avec la période précédente, export CSV des avis filtré par établissement et période. Journées UTC, cinq exports par heure, plafond explicite de 10 000 avis, protection des formules de tableur. Les données doivent avoir été synchronisées ; aucune antériorité fictive n’est créée.
- Mensuel : fonctionnalités métier communes, tableau de bord et graphique 30 jours. L’export RGPD reste accessible à tous les comptes.
- Paramètres → **Annuler mon abonnement** : cocher la confirmation puis valider arrête le renouvellement dans Stripe. L’accès demeure jusqu’à l’échéance payée ou la fin de l’essai. Ce n’est pas un remboursement ; une simple coche ne déclenche rien.
- Essai mensuel : carte obligatoire, contrôle atomique de l’email canonique et d’une empreinte de carte Stripe avant accès, registre HMAC indépendant du compte pendant douze mois. Créer un nouveau compte ou supprimer l’ancien n’efface pas ce registre. Une nouvelle carte et une nouvelle adresse peuvent contourner cette mesure : aucune garantie d’unicité d’une personne n’est annoncée. Voir [trial-abuse-prevention.md](trial-abuse-prevention.md).

## Rattacher un paiement direct au compte

Un lien Stripe public peut être utilisé avant la création du compte. L’application ne fait donc pas confiance à un identifiant d’utilisateur placé dans l’URL ni à une correspondance d’email seule.

1. Stripe envoie son événement signé au serveur Trusteo. Le serveur relit la session, le vrai Payment Link, sa ligne et l’abonnement ; il vérifie la devise EUR, la récurrence, la quantité et le montant autorisés.
2. Le reçu est enregistré avant l’email. Un événement d’abonnement arrivé avant le paiement ou avant le compte reste conservé pour rapprochement.
3. Resend envoie à l’adresse du paiement un lien personnel valable sept jours. Le jeton aléatoire est haché en base ; son enveloppe chiffrée permet la reprise d’un envoi interrompu.
4. Le client crée un compte ou se connecte avec cette même adresse. Le jeton est conservé entre inscription et connexion. Le serveur relit Stripe, verrouille les données et consomme la preuve une seule fois avant de rattacher le paiement. Aucun deuxième Checkout n’est ouvert.

Si la configuration d’email ou la persistance manque, le webhook répond avec une erreur réessayable ; il ne prétend pas avoir activé le payeur. Surveiller les erreurs dans Stripe. Les clients ayant déjà payé peuvent demander un nouveau lien depuis les paramètres ; les preuves expirées sont remplacées, pas réactivées sans vérification.

## Réglages à faire avant l’encaissement public

Les liens publics ne donnent aucun accès administrateur au compte Stripe. Aucune modification de leur configuration distante n’a été effectuée ici : `STRIPE_SECRET_KEY` n’est pas disponible dans cette session.

1. Déployer l’application, appliquer `npm run db:migrate:deploy`, puis démarrer le worker avec la même base. Configurer `APP_URL` HTTPS, `CREDENTIAL_ENCRYPTION_KEY`, PostgreSQL et Redis. L’URL Lovable publique ne remplace pas le serveur.
2. Configurer `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` dans les secrets du serveur, jamais dans Lovable ou le chat. Configurer Resend, un domaine expéditeur vérifié et `EMAIL_FROM`.
3. Dans Stripe, enregistrer `ORIGINE_APPLICATION/api/billing/webhook` avec les événements `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`. Le repère `ORIGINE_APPLICATION` est à remplacer par la véritable adresse déployée.
4. Vérifier les quatre liens dans le même compte et mode Stripe : abonnements récurrents, EUR, une seule ligne et quantité un. Configurer les quatre IDs `price_…` pour le Checkout classique lancé après inscription. Pour les liens directs, le mapping est aussi vérifié avec le Payment Link officiel récupéré chez Stripe.
5. Vérifier ou corriger les périodes d’essai avec le script ci-dessous. `--apply` ne crée pas de produit ni de prix : après validation des quatre prix, il exige la carte, fixe quatorze jours sur le mensuel et supprime l’essai sur l’annuel. Il modifie les futurs passages par les liens, pas les abonnements déjà souscrits.
6. Activer le Customer Portal pour factures, moyens de paiement et annulation. Conserver les changements de formule désactivés tant qu’ils ne passent pas par les contrôles de capacité de l’application.
7. Tester avec les liens et clés de test correspondants : paiement annuel immédiat, essai mensuel unique, email d’activation, signature webhook, remise des deux premières factures, annulation et refus d’un deuxième essai avec la même carte. Les liens fournis ne sont pas présumés être en mode test ; vérifier leur mode avant toute utilisation.

```sh
# Lecture seule, après injection sécurisée de la clé du bon compte Stripe :
npm run stripe:links -- --check
# Après configuration du serveur, du webhook et des emails :
npm run stripe:links -- --apply
# Générer les boutons et le texte Lovable sans inventer une URL d’application :
npm run lovable:links -- --payments-only
```

Le script garde le proxy et la vérification TLS, ne journalise ni clé ni données clients. Il refuse un lien absent ou un prix non conforme avant les mutations. Après une interruption pendant les mises à jour, relancer `--check` pour constater les éventuelles modifications déjà effectuées.

Une redirection Stripe de succès n’est jamais une preuve suffisante d’abonnement. Le coupon d’introduction est appliqué une seule fois au premier essai mensuel admissible ; il n’est pas ajouté à un abonnement déjà payé. Les essais abusifs sont annulés sans facture avant ouverture des droits. Les paramètres distants et les factures réelles doivent encore être validés avec les vraies clés.
