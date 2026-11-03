# Connecter mon entreprise

Le parcours se trouve dans l'espace client, à `/app/connections`, sous le nom **Connecter mon entreprise**. Chaque entreprise utilise son propre compte Trusteo ; les établissements, autorisations et clés restent isolés entre clients.

## Parcours client

1. Choisir un établissement déjà créé dans son compte et la plateforme d'avis.
2. **Google** : cliquer sur Continuer avec Google et autoriser l'application Trusteo sur le site Google. Choisir ensuite une fiche parmi celles accessibles. La saisie des identifiants de compte et de fiche est une alternative à la sélection, après autorisation ; elle ne donne jamais d'accès sans OAuth. Un Place ID public ou une clé Google Maps ne remplace pas cette autorisation.
3. **Trustpilot** : autoriser son compte Business via OAuth, ou choisir une clé API pour une connexion **en lecture seule** si cette clé dispose de l'accès API correspondant. La clé est saisie dans un champ masqué, envoyée au serveur et chiffrée ; elle n'est ni placée dans une URL ni conservée dans le stockage du navigateur.
4. Cliquer sur **Tester ma connexion**. Le serveur lit la fiche réelle et jusqu'à trois avis, sans importer d'avis, publier une réponse ou envoyer une notification pendant ce test.
5. Vérifier l'aperçu : nom, adresse si disponible, site, lien vers la fiche, note et nombre d'avis fournis par la plateforme, extraits des avis. Une liste vide est un résultat valide ; aucune note ou expérience n'est inventée.
6. Cocher l'attestation d'autorisation puis cliquer sur **Confirmer mon entreprise**. Ce n'est qu'à ce moment que la connexion API devient active et qu'une première synchronisation peut être mise en file.

Une clé de lecture publique Trustpilot ne démontre pas les droits de gestion. L'interface l'indique explicitement et la publication directe est bloquée, même si d'anciens jetons OAuth sont présents. Les réponses peuvent être copiées et publiées manuellement par le client sur la plateforme.

Le test vérifie le profil et la lecture des avis. Il ne teste pas la publication, l'IA, l'email ni le push et ne les présente pas comme validés. Les droits de publication dépendent des autorisations réelles accordées par la plateforme.

## Confirmation et sécurité

- L'aperçu est lié au client, à la connexion, aux identifiants de fiche et aux credentials testés. Le reçu serveur est chiffré, son jeton est haché et sa validité est de dix minutes.
- Toute modification d'un champ dans l'interface efface l'aperçu et décoche l'attestation. Un nouveau test invalide le précédent dès son démarrage, y compris s'il échoue. Un ancien appel lent ne peut pas rétablir une preuve après un test plus récent.
- Le serveur exige `accepted:true`, le jeton correct, une preuve non expirée et une configuration inchangée. La consommation est atomique et à usage unique sous verrou PostgreSQL. Un renouvellement OAuth entre le test et la confirmation peut imposer de refaire le test.
- Les endpoints historiques de configuration ne permettent plus d'activer une fiche en contournant l'aperçu. Le worker, la synchronisation manuelle et la publication exigent une confirmation pour les connexions API. Les anciennes connexions API sans `confirmedAt` doivent donc terminer ce parcours.
- Tester une connexion active conserve ses paramètres jusqu'à confirmation d'un changement. Une réautorisation OAuth met la connexion en attente avant l'échange de jetons et impose un nouvel aperçu. Une fiche comportant déjà des avis ne peut pas être réaffectée à une autre entreprise sans déconnexion.
- Le worker nettoie les aperçus expirés lors du dispatch périodique ; sans worker actif, ils restent chiffrés en base mais ne sont plus acceptés pour confirmer.
- Si Redis est indisponible après la confirmation, l'interface annonce que la connexion est confirmée et que la synchronisation n'a pas pu être programmée. Elle ne prétend pas avoir récupéré des avis.

## API de l'application

- `POST /api/connections` démarre la préparation. Pour une API, le statut reste en attente ; une clé Google est refusée. Les modes assisté/email demandent une attestation et affichent l'établissement local avant association.
- `POST /api/connections/:id/preview` effectue les lectures et retourne `{previewToken, expiresAt, testedAt, preview}`. Les credentials et le reçu chiffré ne sont jamais retournés.
- `POST /api/connections/:id/confirm` reçoit `{previewToken, accepted:true}`, active atomiquement la connexion et retourne `{connection, syncQueued, message}`.

## Prérequis d'exploitation

Les identifiants OAuth globaux appartiennent à l'application Trusteo, pas aux commerçants. L'exploitant doit enregistrer son application Google/Trustpilot et obtenir les accès API nécessaires. Chaque client autorise ensuite ses propres comptes. Les conditions et permissions Trustpilot peuvent dépendre de son offre ou contrat.

Cette fonctionnalité est implémentée dans le dépôt Next.js. Elle n'est pas automatiquement publiée sur le site Lovable. Les accès réels Google/Trustpilot restent à vérifier avec des comptes autorisés ; les tests automatisés utilisent des réponses de plateforme simulées. Voir [testing-business-connection.md](testing-business-connection.md).
