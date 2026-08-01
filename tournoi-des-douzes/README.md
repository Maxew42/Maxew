# Le Tournoi des Douzes

Jeu de cartes tactique en français, jouable dans le navigateur contre 1 à 5 IA
ou entre 2 à 6 personnes en pair à pair.

## Lancer le jeu localement

Node.js 18 ou plus récent suffit, notamment Node 20.18.

```bash
npm install
npm run dev
```

Ouvrez ensuite <http://127.0.0.1:3000/>. Le serveur reconstruit automatiquement
le jeu lorsque les sources changent.

## Déploiement GitHub Pages

Le jeu utilise le même workflow statique que les autres jeux du dépôt. Les
fichiers directement servis par GitHub Pages sont :

- `index.html`
- `game.js` et `game.css`
- `cards/`, `favicon.png` et `og.png`

Le workflow racine `.github/workflows/deploy.yml` archive la branche puis publie
ces fichiers tels quels. Aucune étape Node, Vinext ou serveur applicatif n’est
requise sur GitHub Pages.

Après une modification des fichiers dans `app/` ou `src/`, régénérez les deux
fichiers statiques avant de pousser :

```bash
npm run build
npm test
```

L’adresse de production attendue est :
<https://maxew42.github.io/Maxew/tournoi-des-douzes/>.

## Multijoueur WebRTC

Le multijoueur n’utilise aucun serveur de partie ni de signalisation :

1. l’hôte crée une table puis une invitation ;
2. l’invité colle l’invitation et renvoie le code de réponse ;
3. l’hôte accepte cette réponse ;
4. les navigateurs communiquent directement par canal de données WebRTC.

Chaque invité utilise sa propre invitation. L’hôte conserve l’état de référence
et en envoie une vue filtrée à chaque joueur. Aucune IA ne complète une table
multijoueur. GitHub Pages fournit le HTTPS requis par les navigateurs pour les
fonctions WebRTC et presse-papiers.

Les photos sources sont conservées dans `assets/`. Les versions redressées,
recadrées et optimisées pour le jeu sont dans `cards/`.
