# Registre simplifié des traitements — Trusteo

Base de travail à compléter avec l'identité de l'exploitant, la région des services, DPA, contacts RGPD et procédures opérationnelles avant production. Les durées ci-dessous ne prétendent pas décrire des purges automatiques non implémentées.

| Traitement | Rôle / finalité | Données | Base envisagée | Destinataires | Conservation / action à finaliser |
| --- | --- | --- | --- | --- | --- |
| Comptes et sécurité | Exploitant responsable, exécution du service et prévention des abus | Nom, email, téléphone, hash de mot de passe, hash de session, compteurs de limitation | Contrat, intérêt légitime sécurité | Hébergeur web, PostgreSQL | Compte jusqu'à suppression ; session 30 jours ; définir purge régulière sessions expirées et compteurs |
| Facturation | Exploitant responsable | Références Stripe, statut/plan/date ; pas de carte complète en base Trusteo | Contrat, obligations comptables | Stripe, exploitant | Définir conservation légale des factures et conservation Stripe, distincte de l'effacement applicatif |
| Rattachement des paiements directs | Exploitant responsable | Email de paiement, références Stripe, jeton haché et enveloppe chiffrée temporaire | Contrat, sécurité de l’accès payé | PostgreSQL, Resend | Lien7jours, enveloppe effacée après consommation ou purge après expiration ; références financières conservées pour rapprochement, durée légale à définir. Suppression du compte : retrait email en clair des reçus rattachés. |
| Prévention des essais répétés | Exploitant responsable | HMAC email canonique et empreinte de carte Stripe, référence abonnement et dates ; aucune carte complète ou empreinte brute | Intérêt légitime prévention des abus, à documenter | PostgreSQL, Stripe pour vérification |12mois calendaires, indépendamment de la suppression du compte ; purge bornée par le worker toutes10min et lors des demandes d’essai. Pseudonymisation, pas anonymisation. |
| Connexions plateformes | Commerçant responsable, Trusteo sous-traitant | Identifiants externes, tokens chiffrés, journaux de sync | Contrat/DPA, autorisation de connexion | Plateformes officielles, hébergeur | Jusqu'à déconnexion/suppression ; définir purge journaux et révocation des tokens |
| Gestion des avis | Commerçant responsable, Trusteo sous-traitant | Auteur public, note, texte, langue, date, réponse | Intérêt légitime à documenter par le commerçant | Plateforme et infrastructure | Jusqu'à suppression du compte/établissement ; définir revue des données anciennes |
| Assistance IA | Commerçant responsable, Trusteo sous-traitant | Texte et contexte minimal d'avis, brouillons | Base du traitement avis, DPA | OpenAI selon compte et contrat | Vérifier rétention fournisseur, minimiser et exclure données sensibles ; prompts versionnés |
| Campagnes | Commerçant responsable, Trusteo sous-traitant | Nom/email/téléphone, preuve de consentement, token opt-out, traces d'envoi | Consentement approprié au canal et obligations applicables | Resend, Twilio si SMS, worker/Redis | Jusqu'à désinscription/effacement ; conserver preuve minimale d'opposition pour éviter réimport ; définir délai après dernière activité |
| Notifications du compte | Exploitant / commerçant selon contenu | Email, endpoint push et clés, avis concerné | Préférences et consentement push | Resend, service de push navigateur | Jusqu'au retrait ou suppression ; endpoints expirés supprimés par le worker |
| Parrainage et fidélité | Commerçant responsable, Trusteo sous-traitant | Client, email filleul facultatif, codes, référence d'achat attesté | Contrat/intérêt légitime anti-abus à documenter ; aucun avis requis | Infrastructure Trusteo | Code valable 90 jours ; définir purge et preuve minimale anti-double usage ; pas d'envoi non sollicité au filleul |
| Contact commercial / droits | Exploitant responsable | Nom, email, société, demande, consentement de traitement horodaté | Réponse à demande / mesures précontractuelles | Resend, boîte CONTACT_EMAIL | Définir délai de purge des conversations ; aucune inscription marketing implicite |

## Mesures présentes

- Sessions HttpOnly SameSite, secrets chiffrés côté serveur, mots de passe hashés et validation des entrées.
- Accès tenant-scopés, contrôles d'origine sur mutations, limitations distribuées PostgreSQL.
- Export et suppression depuis le compte, suppression relationnelle ; annulation abonnement préalable pour éviter frais persistants.
- Campagnes uniformes et désinscription explicite ; les invitations ne récompensent pas un avis.
- Aucun analytics publicitaire ni cookie tiers ajouté par défaut.

## Actions opérationnelles avant production

1. Compléter le responsable légal, contact RGPD, registre complet et accord de sous-traitance commerçant/Trusteo.
2. Signer/vérifier DPA, régions, sous-traitants et mécanismes de transfert hors EEE ; ne pas annoncer de résidence UE sans preuve.
3. Fixer et implémenter les purges, durées de sauvegardes, tests de restauration et procédure de suppression dans les sauvegardes.
4. Définir la gestion des demandes (délai RGPD), vérification d'identité proportionnée, procédure incident et notification des violations.
5. Vérifier l'information préalable et le consentement par canal pour les listes importées ; ne pas activer SMS sur une simple liste achetée.
6. Contrôler la configuration fournisseur IA (rétention, usage des données) et réduire les données envoyées.
7. Valider les documents publics `/legal`, `/terms`, `/privacy` et renseigner régime de TVA, support, responsabilité et droit applicable.
