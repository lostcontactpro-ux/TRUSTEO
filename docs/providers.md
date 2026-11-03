# Connecteurs d’avis Trusteo

Trusteo utilise uniquement des API officielles, des notifications reçues par email et des actions assistées. Il ne contourne aucun contrôle d’accès et ne scrape pas les plateformes. Une présence dans le catalogue ne signifie pas qu’une intégration API a été activée ou approuvée.

## Deux rôles : exploitant Trusteo et entreprise cliente

- **Exploitant Trusteo** : enregistrer l'application SaaS auprès de Google et Trustpilot, obtenir les accès API nécessaires et configurer les identifiants OAuth de l'application et l'URL de callback une seule fois. Il n'est pas demandé à l'exploitant de connecter les comptes de ses clients ni d'en recueillir les mots de passe.
- **Chaque entreprise cliente** : depuis son espace Trusteo authentifié, connecter son propre compte Google ou Trustpilot, accepter les autorisations sur le site de la plateforme, puis choisir ses fiches Google ou indiquer son Business Unit Trustpilot. Elle doit disposer des droits de gestion et des droits API requis par sa plateforme.

Les identifiants `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` et `TRUSTPILOT_CLIENT_ID`/`TRUSTPILOT_CLIENT_SECRET` identifient l'application Trusteo. Les jetons d'accès et de renouvellement délivrés après consentement sont propres à chaque connexion, chiffrés côté serveur et rattachés à un établissement appartenant au client. L'état OAuth est lié à sa session et à cette connexion ; les routes ne retournent que les connexions de son compte. Aucun jeton de commerçant global n'est partagé entre entreprises clientes.

La disponibilité des API reste soumise aux validations et contrats des plateformes, notamment pour Trustpilot. Déconnecter une connexion locale ne révoque pas automatiquement les autorisations dans le compte Google/Trustpilot : le client peut également les retirer dans les réglages de la plateforme.

## Aperçu et confirmation

Les connexions API sont préparées puis testées via `previewBusiness()` avant toute activation. Le client vérifie le vrai profil et jusqu’à trois avis, puis accepte explicitement l’association. Le reçu expire après dix minutes et ne peut être consommé qu’une fois. Un identifiant Google seul ne donne aucun accès ; Google utilise OAuth. Trustpilot accepte également une clé API publique pour la lecture seule, sans droit de publication ni vérification de gestion. Consulter [Connecter mon entreprise](connect-my-business.md).

## Contrat et modes

Chaque plateforme dispose de son fichier dans `packages/core/src/providers`. Le registre central expose les adaptateurs avec le même contrat `ReviewProvider` : `connect()`, `fetchReviews(since)`, `reply(reviewId, text)` et `capabilities`.

Les capacités décrivent ce que le transport effectivement implémenté permet :

- `canRead` : lecture des avis via ce transport ;
- `canReply` : publication directe d’une réponse via une API officielle ;
- `realtime` : réception d’événements prise en charge, et non simple polling ;
- `requiresPartnership` : accès soumis à validation, contrat ou programme partenaire.

Une connexion a l’un des modes suivants :

1. **API** : OAuth ou clé autorisée pour le compte et l’établissement concernés. La création d’une URL OAuth n’est pas une preuve de connexion réussie.
2. **Email** : réception de notifications transférées vers une adresse dédiée à la connexion. L’email sert à préparer le traitement ; il ne donne aucun droit de publier une réponse.
3. **Assisté** : génération et modification d’une réponse, puis ouverture de l’URL de l’avis et copie explicite du texte. Le gérant publie lui-même sur la plateforme. L’interface ne doit pas marquer la réponse comme publiée avant confirmation.

Les transports API de référence sont Google Business Profile et Trustpilot. Les autres adaptateurs fournissent les modes email/assisté dans cette livraison ; leur API officielle peut exister sans être implémentée. Les mocks sont réservés aux tests et ne doivent jamais faire passer une connexion réelle pour opérationnelle.

## Accès par plateforme

Les programmes, tarifs, quotas et permissions changent. Les liens ci-dessous sont les sources officielles à vérifier pendant l’inscription. Aucun accord partenaire, quota de production ou autorisation n’est présumé acquis par le code.

| Plateforme | Transport livré et possibilités officielles | Démarches de l’exploitant / du client | Limites connues |
| --- | --- | --- | --- |
| **Google Business Profile** | API officielle de lecture des avis et de réponse ; OAuth. | Créer un projet Google Cloud, demander l’accès aux Business Profile APIs, activer les API requises, configurer l’écran de consentement et les URI de redirection ; obtenir le scope `https://www.googleapis.com/auth/business.manage`. Exploitant Trusteo : renseigner les identifiants OAuth de l'application. Client : autoriser son compte et sélectionner ses fiches dans Trusteo. [Accès API](https://developers.google.com/my-business/content/prereqs), [avis](https://developers.google.com/my-business/reference/rest/v4/accounts.locations.reviews). | Le compte connecté doit gérer un établissement admissible et vérifié. L’approbation Google et des quotas non nuls sont nécessaires. Le polling ne garantit pas la remontée immédiate ; une notification Pub/Sub exige une configuration supplémentaire et n’est pas déclarée temps réel par défaut. |
| **Trustpilot** | API officielle Business : lecture des avis et réponse autorisée, avec authentification du compte Business. | Exploitant Trusteo : enregistrer l'application, configurer OAuth et obtenir l'accès d'intégration. Client : autoriser son propre compte Business, renseigner son Business Unit ID et disposer des droits et de l'offre/API convenus avec Trustpilot. [Documentation](https://developers.trustpilot.com/), [Business Units](https://developers.trustpilot.com/business-units-api). | Les accès privés et certaines fonctions dépendent du contrat. Le TrustScore n’est pas la moyenne arithmétique des notes individuelles : le dashboard Trusteo indique sa propre moyenne. Ne pas considérer une clé publique seule comme un droit de répondre. |
| **Facebook** | Email/assisté. Graph API peut exposer des recommandations/avis de Pages selon les permissions et la version. | Créer une application Meta, la faire examiner si nécessaire, obtenir les permissions de Page et un jeton autorisé. Valider les endpoints et droits à la version choisie avant d’ajouter un transport API. [Pages API](https://developers.facebook.com/docs/pages-api/). | Accès dépendant du rôle sur la Page, des permissions et de l’App Review. Aucune publication API n’est activée dans cet adaptateur. |
| **Instagram** | Assisté ; ingestion email uniquement si une notification pertinente est réellement disponible. | Relier un compte professionnel et une application Meta si une future intégration aux interactions devient nécessaire. [Instagram Platform](https://developers.facebook.com/docs/instagram-platform/). | Instagram ne fournit pas de fil standard d’avis notés comparable à Google. Un commentaire ou un message n’est pas automatiquement un avis ; ne pas inventer de note. |
| **TripAdvisor** | Email/assisté. Content API accessible sur inscription pour certains contenus. | Demander une clé Content API ou un accord partenaire adapté. [Content API](https://tripadvisor-content-api.readme.io/reference/overview). | Un accès au contenu ne donne pas de droit général de réponse ; couverture, nombre d’avis et usage sont contractuels. La gestion des réponses reste assistée ici. |
| **TheFork / LaFourchette** | Email/assisté ; accès métier/partenaire éventuel. | Contacter TheFork/TheFork Manager pour un accès partenaire autorisé et les droits précis de lecture/réponse. [TheFork Manager](https://www.theforkmanager.com/). | Aucune API publique universelle de gestion d’avis n’est supposée disponible. |
| **Yelp** | Email/assisté. Yelp Places API peut fournir des données et des extraits d’avis suivant l’offre. | Créer une application Yelp et vérifier l’offre API et ses conditions ; négocier un accès supplémentaire si nécessaire. [Développeurs Yelp](https://docs.developer.yelp.com/). | Les extraits ne représentent pas nécessairement tous les avis ; la réponse du commerçant n’est pas une capacité générale de l’API publique. |
| **Pages Jaunes / Solocal** | Email/assisté ; intégration partenaire à valider auprès de Solocal. | Demander un accès et la documentation contractuelle au fournisseur. [Solocal](https://www.solocal.com/). | Pas de promesse d’API publique de lecture/réponse ; aucune collecte de pages web. |
| **Apple Business Connect / Plans** | Assisté ; notification email lorsqu’elle existe. | S’inscrire à Apple Business Connect et demander un éventuel accès API partenaire. [Business Connect](https://businessconnect.apple.com/), [guide](https://support.apple.com/guide/apple-business-connect/welcome/web). | Les API de gestion de fiches ne constituent pas une API générale d’avis et de réponses ; certaines appréciations proviennent de tiers. |
| **Foursquare** | Assisté ; ingestion email pertinente si disponible. Places API existe pour les lieux et certains contenus. | Obtenir une clé Places API et vérifier licence et types de contenu permis avant extension. [Foursquare Places](https://docs.foursquare.com/). | Un « tip » n’est pas nécessairement un avis noté ; ne pas lui attribuer une note artificielle. Pas de réponse API promise ici. |
| **Avis Vérifiés / Skeepers** | Email/assisté ; API réservée aux clients/partenaires selon contrat. | Demander les identifiants, la documentation API et les droits de consultation/réponse à Skeepers. [Skeepers](https://skeepers.io/), [Avis Vérifiés](https://www.avis-verifies.com/). | Respecter le processus d’authentification des avis, de modération et les droits contractuels ; ne pas injecter de faux achats. |
| **Booking.com** | Email/assisté ; Guest Reviews API pour partenaires de connectivité autorisés. | Candidater au programme Connectivity Partner, obtenir les droits de l’hébergement et valider les fonctionnalités autorisées. [Connectivity](https://developers.booking.com/connectivity/docs/). | Réservé aux hébergements/partenaires et permissions correspondants ; aucune clé voyageur générique ne donne accès aux avis privés ou à la réponse. |
| **Airbnb** | Email/assisté ; intégrations limitées aux programmes partenaires. | Contacter Airbnb pour un accord logiciel partenaire si nécessaire. [Partenaires logiciels](https://www.airbnb.com/software-partners). | Pas d’API publique universelle d’avis. Ne pas demander de cookies de session ni automatiser la connexion web. |
| **Expedia / Hotels.com** | Email/assisté ; accès de gestion via programmes partenaires autorisés. | Contacter Expedia Group et obtenir l’accès approprié pour l’hébergement. [Expedia Group Developers](https://developers.expediagroup.com/). | L’accès aux avis pour l’affichage côté voyageur ne constitue pas un droit de gestion ou de réponse pour l’hôtel. |
| **Uber Eats** | Email/assisté ; API partenaires pour fonctions explicitement autorisées. | Demander les droits auprès d’Uber Eats et consulter la documentation du programme. [Uber Eats API](https://developer.uber.com/docs/eats/introduction). | Les API commandes/menu ne prouvent pas l’existence d’un accès aux avis. Pas de transport d’avis API activé ici. |
| **Deliveroo** | Email/assisté ; accès partenaire à vérifier. | Contacter Deliveroo et demander la portée exacte du contrat d’intégration. [Deliveroo Developers](https://developers.deliveroo.com/). | Une intégration commandes n’accorde pas automatiquement de droit de lecture/réponse aux avis. |
| **Just Eat** | Email/assisté ; intégration partenaire à vérifier. | Demander l’accès approprié au programme Just Eat Takeaway. [Documentation partenaire](https://developers.just-eat.com/). | Couverture selon pays et contrat ; aucune API d’avis supposée opérationnelle sans validation. |
| **Google Shopping / Merchant** | Email/assisté ; Merchant APIs pour domaines fonctionnels documentés. | Créer un compte Merchant Center, vérifier les permissions et le programme concerné. [Merchant API](https://developers.google.com/merchant/api). | Les flux d’avis produits/commerçants et la soumission d’avis ne sont pas un fil universel de gestion des avis Google Business. Ne pas fabriquer d’avis produits. |
| **App Store** | Email/assisté ; API officielle App Store Connect disponible pour une future extension. | Générer une clé App Store Connect avec le rôle adéquat ; configurer issuer ID, key ID et signature JWT sécurisée. [Customer reviews](https://developer.apple.com/documentation/appstoreconnectapi/customer-reviews). | Les avis concernent une application et ses territoires. La clé privée ne doit pas être envoyée au navigateur. Le transport JWT n’est pas implémenté dans cette livraison. |
| **Google Play** | Email/assisté ; Android Publisher API propose lecture et réponse aux avis. | Activer Android Publisher, autoriser un compte de service sur l’application dans Play Console et choisir les permissions minimales. [Reply to reviews](https://developers.google.com/android-publisher/reply-to-reviews). | Quotas et couverture de l’API s’appliquent. Le transport compte de service n’est pas implémenté ici ; un avis sans commentaire n’est pas inventé par le connecteur. |
| **Capterra** | Email/assisté ; accès éventuel via Gartner Digital Markets. | Contacter Gartner Digital Markets pour un programme et des droits API adaptés. [Gartner Digital Markets](https://www.gartner.com/en/digital-markets). | Aucune API publique universelle de réponse n’est supposée disponible. |
| **G2** | Email/assisté ; accès données/partenaire selon offre. | Demander les droits au programme G2 et consulter le contrat. [G2 Data Solutions](https://www.g2.com/data-solutions). | Accès aux données et réponse aux avis sont des droits distincts ; pas de transport API activé ici. |
| **Custom** | Email/assisté générique. | Saisir l’URL HTTPS de la fiche/de l’avis et activer une redirection de notification légitime si disponible. | Aucune requête arbitraire vers une URL fournie par un utilisateur ; aucune API inconnue n’est appelée. Les actions restent manuelles. |

## Synchronisation, erreurs et quotas

Le worker doit programmer la synchronisation des connexions API actives toutes les dix minutes, conserver un curseur de dernière synchronisation réussie et journaliser chaque tentative. Une pagination terminée seule autorise l’avancement du curseur. Les avis doivent être dédupliqués par connexion et identifiant externe, et mis à jour si la plateforme modifie un avis ou sa réponse.

Les appels HTTP appliquent un délai maximal et une pagination bornée. Une erreur `429` utilise `Retry-After` lorsqu’il est valide, puis un retry exponentiel avec un nombre d’essais borné. Un `401` peut déclencher un renouvellement de jeton ; un refus persistant nécessite une reconnexion. Les `403`, erreurs d’accès partenaire ou paramètres invalides ne doivent pas être masqués par des retries infinis. Un échec de publication ne doit jamais marquer un avis comme répondu.

Conserver les nouveaux jetons de manière chiffrée côté serveur lorsqu’un callback de renouvellement les fournit. Les journaux ne doivent contenir ni jetons, ni secrets, ni corps complet d’emails. Ajouter des webhooks seulement après implémentation de la vérification cryptographique prévue par la plateforme ; l’existence d’un webhook dans une documentation ne signifie pas que `realtime` est actif dans Trusteo.

## Ingestion email et sécurité

Une adresse d’ingestion unique constitue un routage, pas une authentification. Configurer le domaine d’entrée, un fournisseur qui vérifie les signatures de webhook et une association serveur de l’adresse destinataire à la connexion. Vérifier l’authenticité de la notification à partir des métadonnées du fournisseur ; l’en-tête `From` seul est insuffisant et une redirection peut modifier les résultats SPF/DKIM. En cas d’incertitude, placer l’import en attente de validation du gérant.

Le parseur n’exécute pas le HTML et n’utilise pas les liens reçus pour effectuer des requêtes réseau. Valider et borner les champs, utiliser du texte brut, normaliser les notes sur cinq uniquement lorsqu’une note réelle est fournie, et conserver un identifiant source stable pour éviter les doublons. Un email sans note ne doit pas devenir un faux avis cinq étoiles. Ne pas faire confiance à un établissement ou à un tenant indiqué dans le contenu : l’association vient de la connexion côté serveur.

Les emails peuvent contenir des données personnelles : limiter leur stockage, appliquer la durée de conservation du registre RGPD et retirer les informations inutiles avant une génération IA. Les avis et emails sont des données non fiables : leur contenu ne doit pas être interprété comme des instructions système ou des commandes.

## Invitations, offres et avis authentiques

Inviter tous les clients éligibles avec le même message et les mêmes conditions, sans sélectionner selon la note attendue. Ne jamais demander de note minimale, acheter/créer de faux avis ni offrir une remise en échange d’un avis. Google interdit notamment les avis incités par un avantage ; une invitation doit donc être indépendante de toute remise.

Le programme de fidélité/parrainage peut délivrer un avantage de 10 % après un achat réel validé, sans condition liée à un avis ni à sa note. Utiliser un code non prévisible à usage unique et une contrainte d’unicité sur l’achat/client pour limiter les doublons. Cela ne prouve pas qu’un avis externe est unique : sans identifiant officiel vérifiable, Trusteo ne doit pas prétendre dédupliquer des personnes ou des avis sur plusieurs plateformes.

Pour un avis inférieur à 3,3/5, créer une alerte prioritaire et proposer trois réponses professionnelles. Ne pas créer d’avis positifs pour masquer cet avis.

## Validation avant production

Les tests unitaires utilisent des réponses HTTP simulées pour couvrir mapping, pagination, renouvellement de jetons, quotas, erreurs et modes assistés. Ils ne prouvent pas l’accès à un compte réel. Avant activation, chaque entreprise cliente doit connecter l'un de ses établissements autorisés, vérifier la récupération d’un avis connu et publier une réponse approuvée sur un avis de test réel avec l’autorisation du gérant. Les secrets et permissions manquants restent des prérequis de production, pas des raisons de simuler une intégration réussie.
