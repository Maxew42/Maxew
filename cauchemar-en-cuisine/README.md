# 🍳 Cauchemar en Cuisine

Bullet hell de survie dans une cuisine de restaurant. Vous êtes le chef ; la vermine (souris, rats, cafards, mille-pattes, chats de gouttière, rats géants, ratons laveurs) envahit la cuisine par vagues de plus en plus violentes. Survivez 10 minutes… et **Philippe ChuileBest**, le chef ultime, entre en cuisine pour un vrai combat de boss : charges télégraphées, volées d'assiettes, coups de poêle au sol et invocations de vermine. Battez-le pour valider le service.

Des bonus apparaissent parfois sur la carte, comme le 🧲 **aimant** qui attire d'un coup tout le fromage vers vous.

100% statique : HTML + JavaScript vanilla, rendu 3D low-poly avec Three.js (embarqué dans `lib/`, aucun CDN), aucun build. Vue du dessus légèrement inclinée, personnages en primitives 3D.

## Jouer en local

Ouvrez simplement `index.html` dans un navigateur, ou servez le dossier :

```bash
python3 -m http.server 8000
# puis http://localhost:8000
```

## Contrôles

### Clavier / souris

| Touche | Action |
|---|---|
| Flèches / WASD | Se déplacer |
| Souris | Viser (les armes tirent automatiquement) |
| Échap / P | Pause |
| M | Couper le son |

### Mobile (tactile, mode paysage)

Le jeu se joue en paysage : en portrait, un écran invite à tourner l'appareil (sur Android, le jeu passe en plein écran et verrouille l'orientation au lancement).

Sur iOS, Safari ne permet pas toujours de masquer sa barre d'outils (API plein écran disponible seulement à partir d'iOS 16.4). La solution fiable : **Partager → « Sur l'écran d'accueil »**, puis lancer le jeu depuis l'icône — il s'ouvre alors sans aucune interface navigateur (manifeste PWA + icônes fournis). Une astuce s'affiche automatiquement sur l'écran titre des iPhone/iPad.

| Geste | Action |
|---|---|
| Pouce gauche (moitié gauche) | Joystick virtuel pour se déplacer |
| Pouce droit (moitié droite) | Joystick virtuel pour viser — sans lui, visée automatique sur l'ennemi le plus proche |
| ⏸ / 🔊 (en haut à droite) | Pause et son |
| Toucher l'écran en pause | Reprendre |

## Armes

- 🍳 **Poêle** (départ) — frappe l'ennemi le plus proche
- 🔪 **Couteau** — lancé en ligne vers la souris, transperce
- 🪓 **Hachoir** — dégâts rapides en cercle autour de vous
- 🔥 **Chalumeau** — jets de feu en croix
- ⚡ **Couteau électrique** — arc qui saute d'ennemi en ennemi
- 🥣 **Batteur à œufs** — fouets en orbite
- 🌶️ **Siphon piquant** — sauce piquante qui reste au sol
- 🍾 **Bouchon de champagne** — tir dévastateur qui ricoche sur les murs

À chaque niveau : améliorer une arme (dégâts + cadence), en prendre une nouvelle (5 max), améliorer le chef (+vitesse, +PV max), ou rarement se soigner. Le meilleur temps est sauvegardé dans le navigateur (`localStorage`).

## Déployer sur GitHub Pages

1. Créez un dépôt GitHub et poussez le contenu de ce dossier :

   ```bash
   cd coup-de-feu
   git init
   git add .
   git commit -m "Coup de Feu"
   git branch -M main
   git remote add origin https://github.com/<votre-user>/coup-de-feu.git
   git push -u origin main
   ```

2. Sur GitHub : **Settings → Pages → Build and deployment** → Source : *Deploy from a branch* → Branch : `main`, dossier `/ (root)` → **Save**.

3. Le jeu est en ligne quelques minutes plus tard sur `https://<votre-user>.github.io/coup-de-feu/`.

Aucune étape de build : `index.html`, `game.js` et `lib/three.min.js` suffisent.

## Debug

Dans la console du navigateur : `DEBUG.gainXp(50)`, `DEBUG.setTime(300)`, `DEBUG.godMode()`, `DEBUG.info()`.
