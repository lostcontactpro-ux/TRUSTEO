# Essais mensuels : prévention des réinscriptions abusives

Les essais gratuits concernent les abonnements mensuels. Les abonnements annuels et les mensualités sans essai restent payants et ne sont pas bloqués par ce registre. Cette mesure réduit les essais répétés ; elle ne prouve pas l'identité d'une personne et ne peut pas empêcher toute combinaison de nouvelles adresses et de nouvelles cartes.

## Décisions et données minimales

Le registre `TrialUsage` est indépendant de `User` : supprimer puis recréer un compte n'efface pas l'usage d'un essai. Il conserve uniquement l'identifiant d'abonnement Stripe, deux HMAC, la date d'enregistrement et son expiration. Il ne conserve ni email en clair, ni numéro de carte, ni empreinte Stripe brute.

- L'email est normalisé en minuscules et sans espaces extérieurs. Pour `gmail.com` et `googlemail.com` uniquement, les points et le suffixe `+alias` sont retirés et le domaine devient `gmail.com`. Les règles d'alias des autres fournisseurs ne sont pas supposées.
- L'identifiant de carte est exclusivement `card.fingerprint` obtenu côté serveur depuis un objet Stripe vérifié. Il reste sensible à la casse. Une valeur envoyée par le navigateur ne constitue jamais cette vérification.
- Chaque identité utilise HMAC-SHA-256 avec un contexte distinct email/carte. La clé est dérivée de `CREDENTIAL_ENCRYPTION_KEY` avec le contexte versionné `trusteo:monthly-trial-identity:key:v1` ; elle n'est pas partagée directement avec le chiffrement OAuth.
- Ces HMAC sont des données pseudonymisées, pas anonymes. Ils ne sont jamais renvoyés dans les API publiques, pages ou messages de refus.

## Flux serveur

`apps/web/src/lib/trial-eligibility.ts` fournit :

1. `canOfferMonthlyTrial({email, cardFingerprint?})` avant Checkout : exclut une identité déjà connue. Sans carte déjà accessible, cette offre reste provisoire ; elle n'active aucun droit.
2. `claimMonthlyTrial({stripeSubscriptionId, email, cardFingerprint, interval, hasTrial})` après réception signée et récupération de l'état actuel Stripe : exige une carte vérifiable pour un nouvel essai mensuel. Une transaction sérialisable et trois contraintes uniques protègent simultanément l'abonnement, l'email canonique et la carte. Deux comptes concurrents partageant l'une des identités ne reçoivent pas deux essais.
3. La livraison répétée du même abonnement avec les mêmes identités est idempotente. Si la persistance des droits échoue après l'enregistrement, la reprise reconnaît le même abonnement. Une identité différente sur un abonnement déjà enregistré exige un rapprochement ; ne pas l'assimiler sans examen à un nouvel essai, notamment après une modification de carte.
4. La réponse `not_applicable` autorise les annuels et mensualités payantes sans inscrire d'identité. L'absence de carte vérifiable ne doit jamais devenir une approbation implicite d'un essai.

L'intégration de facturation doit effectuer cette vérification **avant** d'accorder l'accès local. Un lien Stripe public peut créer un essai avant que le webhook parvienne à Trusteo : le webhook peut alors refuser l'accès et annuler cet essai abusif, puis proposer le compte existant ou une formule payante. Il ne faut pas présenter ce mécanisme comme un blocage garanti de tous les essais directement dans le Checkout Stripe. Le coupon d'introduction est réservé au premier essai admissible.

## Expiration et purge

Choix : expiration logique après **12 mois calendaires**, avec un 29 février ramené au 28 février de l'année suivante. Une identité expirée n'empêche pas une nouvelle demande ; cette durée n'est donc pas une interdiction à vie.

Chaque demande d'essai vérifiable appelle réellement `purgeExpiredTrialUsage()` et supprime au maximum 500 anciennes lignes. La transaction supprime aussi les anciennes lignes correspondant exactement aux identités de la demande, même en présence d'un arriéré de purge. Le dispatcher du worker effectue également cette purge au démarrage puis toutes les **10 minutes**, par lots de 500, sans dépendre de nouvelles inscriptions. Le worker doit donc rester actif ; une interruption ou un arriéré retarde l'effacement physique. L'expiration logique reste immédiate à l'échéance, mais la suppression physique n'est pas promise à la seconde exacte des 12 mois.

Le même traitement efface au maximum 500 `PaymentReceipt.tokenEnvelope` pour les reçus non réclamés dont la preuve a expiré. Il conserve les références du paiement et ne supprime pas le reçu. Les critères d'expiration et d'absence de réclamation sont revérifiés au moment de l'effacement pour préserver une preuve renouvelée ou un reçu réclamé concurremment. Un renvoi de lien passe par la facturation, qui crée une nouvelle preuve ; le worker ne réactive jamais l'ancienne.

Conserver la clé HMAC stable pendant cette fenêtre. La changer sans stratégie de migration empêche de reconnaître les anciennes identités ; une rotation ne doit pas être présentée comme préservant automatiquement l'historique anti-abus. Sauvegardes, politique de confidentialité et registre des traitements doivent décrire cette conservation antifraude distincte de la suppression du compte.

## Limites et validation

Une carte partagée entre plusieurs gérants peut légitimement n'ouvrir droit qu'à un seul essai gratuit ; chacun peut ensuite souscrire une formule payante. Les nouvelles cartes, certaines tokenisations de portefeuilles, des empreintes différentes selon les régions ou de nouvelles adresses indépendantes ne sont pas une identité universelle. Aucun numéro de carte, document d'identité ni profilage externe supplémentaire n'est collecté pour compenser ces limites.

Les tests unitaires vérifient les aliases Gmail, la séparation HMAC, le refus sans carte, les renouvellements payants, l'idempotence, les conflits d'identités, les courses simulant les contraintes uniques, les reprises après conflit de sérialisation et la purge bornée. Ils ne constituent pas un essai bancaire réel ni la preuve d'une interception de tous les abus possibles via Stripe.
