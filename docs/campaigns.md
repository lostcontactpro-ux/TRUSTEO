# Campagnes, parrainage et fidélité

Les contacts doivent fournir un consentement documenté (source/date). Import CSV UTF-8 : `email,name,phone,consent,consentSource`, consent exactement `true`. Les imports ne réactivent jamais un désabonnement. Maximum 5 000 lignes par import, déduplication par email/compte.

Une campagne invite tous les contacts consentants, sans segmentation par note ni satisfaction. Le premier envoi fige les destinataires ; un nouvel envoi ne crée pas de doublons. Les messages utilisent un modèle neutre identique, un lien d'avis de l'établissement et un lien de désinscription. Le texte d’ouverture est limité à quatre salutations approuvées ; le corps neutre est imposé côté serveur. Les champs promotionnels sont refusés : Google interdit les avis incentivés, même sans imposer une bonne note. Les avis fictifs ne sont jamais générés ni publiés.

Les emails nécessitent Resend + domaine vérifié. SMS : `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`; sous-traitance et coûts à vérifier. `REDIS_URL` et un worker permanent sont requis. Le web conserve les destinataires avant ajout à la queue : relancer l'envoi après panne Redis reprend les destinataires en attente. Queue `trusteo-delivery`, job `campaign-recipient`, `{recipientId}`, ID `recipient-{id}`, cinq tentatives exponentielles. Le worker doit recontrôler consentement et désinscription juste avant envoi, utiliser l'idempotency key Resend `recipient-{id}`, et enregistrer uniquement les envois confirmés. Les retries SMS après une réponse réseau indéterminée doivent être vérifiés pour éviter les doublons.

## Parrainage et remise -10 %

Un client peut partager son code avec famille/amis. Aucune adresse de filleul n'est contactée automatiquement : l'ancien client partage lui-même son code. Un filleul déjà enregistré et l'auto-parrainage sont refusés à la création nominative. Le commerçant valide un achat réel du filleul via `PUT /api/referrals/redeem` avec `purchaseVerified:true`, `purchaseReference`, `code`.

La remise de fidélité est **indépendante d'un avis** : `PUT /api/referrals` après un achat réel attesté par le commerçant (`contactId`, `purchaseReference`, `purchaseVerified:true`) émet un code aléatoire 128 bits, valable 90 jours, un par client et référence d'achat par compte. `POST /api/referrals/redeem` consomme atomiquement le code lors d'un autre achat. Aucun champ note/avis n'est requis. Sans intégration caisse, Trusteo conserve une attestation du commerçant, pas une preuve technique du paiement. La déduplication email ne prouve pas l'identité d'une personne : les alias doivent être contrôlés en caisse.

## Désinscription

Le lien `/unsubscribe?token=...` doit afficher une confirmation puis appeler `POST /api/unsubscribe`. GET n'altère jamais le consentement, afin que les robots d'analyse d'emails ne désabonnent pas un client. Le token est aléatoire de 256 bits. Les suppressions RGPD effacent contacts et traces liées au compte.
