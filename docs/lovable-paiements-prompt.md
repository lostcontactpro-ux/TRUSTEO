# Texte à coller dans Lovable

Ce texte applique les liens publics et le contenu des tarifs au site Lovable. Il ne déploie pas le serveur Trusteo et ne configure pas Stripe. L’annulation, le rattachement des paiements et le contrôle des essais nécessitent le serveur, PostgreSQL, le webhook Stripe et les emails configurés : voir [paiements-directs.md](paiements-directs.md).

Copier le texte ci-dessous dans la conversation du projet Lovable :

```text
Sur mon site https://trus-teo.lovable.app, conserve le design, les couleurs et les sections existantes. Mets à jour les cartes de tarifs Trusteo et leurs boutons avec ces liens Stripe publics exacts :

- Essentiel mensuel : https://buy.stripe.com/14A3cv2Fn5Up4ssg3Zes004
- Essentiel annuel : https://buy.stripe.com/eVqfZh4Nv1E95ww3hdes002
- Pro mensuel : https://buy.stripe.com/14AdR9gwdfuZbUU8Bxes003
- Pro annuel : https://buy.stripe.com/6oUbJ193L4Qlf765ples001

Le sélecteur mensuel/annuel change à la fois le tarif et le href du bouton. Utilise des liens normaux dans la même fenêtre, sans iframe, ni paiement embarqué. N’ajoute aucune clé API ou clé Stripe dans le code client.

Mets l’annuel en avant, sélectionné par défaut. Essentiel : 409 €/an, soit environ 34,08 €/mois, payé en une fois ; économie 188,60 €/an (31,6 %). Pro : 980 €/an, soit environ 81,67 €/mois, payé en une fois ; économie 328 €/an (25,1 %). Précise que les économies comparent douze mensualités au tarif normal, hors remise de bienvenue. Évite fausse urgence, faux témoignages ou économies calculées contre un prix inventé.

Sur l’annuel, affiche « Sans essai gratuit — paiement annuel immédiat » et un bouton « Choisir l’annuel ». Les avantages annuels réels de l’application sont l’analyse de réputation sur 90 et 365 jours et l’export CSV des avis. Les fonctionnalités communes restent : avis centralisés, trois tons de réponse IA, notifications, campagnes conformes, parrainage et fidélité. Essentiel : jusqu’à 3 établissements ; Pro : jusqu’à 20. Ne promets pas de support premium ou de service non livré.

Sur le mensuel, affiche 49,80 €/mois pour Essentiel et 109 €/mois pour Pro. L’essai de 14 jours avec carte et la remise de 20 % sur les 2 premières mensualités sont réservés aux nouveaux clients éligibles, un seul essai par client, sous réserve des réglages Stripe. Le tarif annuel ne cumule pas cette remise. Vérifie qu’aucun texte de la FAQ, du hero ou des tarifs ne promet un essai sur l’annuel.

Annonce le renouvellement automatique et la possibilité d’annuler le renouvellement depuis le compte, avec accès jusqu’à l’échéance. Ne simule ni activation d’abonnement ni annulation côté navigateur : ces actions reposent sur le serveur Trusteo et les événements signés Stripe. Garde les boutons accessibles au clavier et vérifie le rendu à 375 px.
```

Régénération depuis les tarifs centralisés : `npm run lovable:links -- --payments-only`.
