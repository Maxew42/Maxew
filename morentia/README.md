# Morentia — table de test numérique

Application 100 % frontend pour jouer et tester Morentia sur ordinateur ou smartphone. Elle reprend le catalogue et les décisions du classeur `Morentia_cartes_equilibrees_test_physique_v1.xlsx`.

## Lancer localement

Les modules JavaScript et le service worker nécessitent un serveur HTTP :

```bash
cd morentia
npm run serve
```

Ouvrez ensuite `http://localhost:4173`. Aucun build n’est nécessaire. Le dossier est directement publiable par le workflow GitHub Pages du dépôt.

## Fonctionnalités

- table 2–3 joueurs, tour partagé ou adversaires IA ;
- moteur déterministe : mise en place, or actif/réserve, influence, contrôle, Crépuscule, Guerre, Nuit, Seuils, Durées, PV, Survivants et remplacement des lieux ;
- effets récurrents automatisés et outil **Arbitre** pour les choix complexes ou un test ciblé ;
- P2P WebRTC à hôte navigateur, avec signalisation manuelle par copier-coller et aucune infrastructure applicative ;
- Studio de cartes avec design global et champs visuels par carte ;
- import/export `.xlsx` compatible avec les feuilles du classeur source ;
- PWA installable et utilisable hors ligne après la première visite.

## Conventions numériques explicites

L’application utilise des conventions testables et visibles dans l’onglet **Règles** : une action alternée jusqu’aux passes, premier déploiement gratuit puis 1 or, trois cartes au Marché, deux Lieux et une sélection interactive des Survivantes de chaque joueur. Les Survivantes retournent au domaine ; les autres cartes sont défaussées.

## Multijoueur

L’hôte génère une invitation, le second navigateur la colle et renvoie sa réponse, puis l’hôte l’accepte. Répétez l’opération pour un troisième navigateur. Les actions et l’état passent ensuite directement par un canal WebRTC chiffré. Un STUN public sert uniquement à découvrir le chemin réseau ; aucun état de partie n’est stocké sur un serveur.

## Illustrations

Les quatre images par défaut sont des photos gratuites sous licence Unsplash, conservées localement pour le mode hors ligne : Dan Begel (Kalassir), Hacı Elmas (Aqaba), George Hiles (Algarie) et HsinKai Tai (cartes neutres et lieux). Chaque carte peut remplacer son illustration dans le Studio ou la colonne `Illustration` du classeur exporté.
