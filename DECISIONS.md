# Décisions Trusteo

- Nom public : **Trusteo** (remplace Testeo).
- Monorepo npm workspaces, Next.js App Router, TypeScript strict, PostgreSQL/Prisma, worker BullMQ/Redis séparé : Vercel héberge le web, pas un worker permanent.
- Utiliser le checkout isolé existant ; ne pas créer de worktree sans demande explicite.
- Aucun faux avis, achat d'avis, scraping interdit ou filtrage par satisfaction. Une note < 3,3/5 déclenche une priorité de traitement, jamais de nouveaux avis artificiels.
- Parrainage et fidélité : remise 10 % liée à une visite/achat vérifié, utilisable une fois par client. Jamais conditionnée au dépôt d'un avis, à son unicité ou à sa note ; les plateformes peuvent interdire toute incitation aux avis.
- Les services tiers exigent les propres comptes et autorisations de l'exploitant. Aucun mode démonstration ne doit prétendre avoir effectué un paiement, envoyé un message ou publié un avis réel.
- Pro : jusqu'à 20 établissements, Essentiel : jusqu'à 3. Le seuil de 3 pour Pro est un positionnement commercial, pas une obligation de créer 3 établissements.
- Entreprise : devis et plafond accordé explicitement côté serveur, aucune limite infinie implicite.
- Textes juridiques et témoignages exemples : brouillons identifiés, à personnaliser avant production.
