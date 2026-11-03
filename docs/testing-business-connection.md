# Vérifier « Connecter mon entreprise »

Le parcours distingue trois opérations : autoriser ou renseigner l’accès, tester la fiche en lecture seule, puis confirmer explicitement l’association à Trusteo. Un identifiant de fiche ou une clé publique Trustpilot ne prouve pas les droits de gestion et n’autorise pas les réponses privées.

## Exécution locale

Depuis la racine du monorepo, avec PostgreSQL configuré et les migrations appliquées :

```sh
npm run db:generate
npm run db:migrate
npm run test:e2e -- tests/e2e/business-connection.spec.ts
```

Le fichier Playwright existant démarre un serveur de test à 375 px sur le port 3100. Une base dédiée peut être indiquée avec `E2E_DATABASE_URL`. Les tests créent des utilisateurs uniques `e2e-…@example.test` et ne suppriment que leurs propres données ; aucune remise à zéro de la base n’est exécutée. Ne pas employer une base de production. Ne pas lancer plusieurs suites contre le même serveur de test en même temps.

## Portée des tests

| Scénario | Ce qui est réellement exercé | Ce qui est remplacé |
| --- | --- | --- |
| Aperçu et confirmation visuels | Inscription et session réelles, établissement et connexion Trustpilot initialement `pending` en PostgreSQL, formulaire mobile, champ clé masqué, test obligatoire, aperçu, consentement, invalidation lorsque la fiche change, absence de clé dans les URL et stockages navigateur | Les réponses HTTP `/preview` et `/confirm` et le statut affiché après confirmation sont des fixtures explicites. La connexion en base reste `pending`. Aucun accès Trustpilot n’est revendiqué. |
| Erreur d’expiration dans le navigateur | Traitement de l’erreur, absence de statut connecté en base, de journal de synchronisation et de date de synchronisation | L’aperçu et l’erreur HTTP d’expiration sont des fixtures visuelles. |
| Garde-fous API | Véritables handlers, cookies, contrôles propriétaire, refus de consentement absent, reçu manquant, jeton différent, expiration et reçu altéré ; aucune activation, aucun avis importé, aucune synchronisation | Des champs de reçu volontairement inutilisables sont insérés dans les seules données de test pour atteindre les branches d’expiration et d’intégrité. Aucun reçu permettant une activation n’est fabriqué. |

La chaîne utilisée comme clé est une valeur d’exemple manifestement invalide. Les tests ne lisent ni ne transportent de vraie clé de plateforme. Le reçu opaque utilisé par les fixtures visuelles n’est jamais accepté par le serveur réel.

La vérification complète avec Google OAuth ou une clé Trustpilot autorisée reste une validation d’intégration distincte : contrôler l’entreprise réelle affichée, la liste des fiches autorisées, la durée et l’usage unique du reçu, puis confirmer et constater la première synchronisation. Pour Trustpilot par clé publique, vérifier que l’interface indique la lecture seule et ne propose pas de publier une réponse. Les tests de handlers et de providers complètent les tests navigateur ; ils ne remplacent pas cette vérification avec les comptes de l’exploitant.
