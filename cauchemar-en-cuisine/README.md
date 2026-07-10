# 🍳 Cauchemar en Cuisine

Bullet hell de survie en deux niveaux.

**Niveau 1 — Le service.** Vous êtes le chef ; la vermine (souris, rats, cafards, mille-pattes, chats de gouttière, rats géants, ratons laveurs) envahit la cuisine par vagues de plus en plus violentes. Survivez 10 minutes… et **Philippe ChuileBest**, le chef ultime, entre en cuisine pour un vrai combat de boss : charges télégraphées, volées d'assiettes, coups de poêle au sol et invocations de vermine. Battez-le pour valider le service.

**Niveau 2 — La cuisine de Pablo** (déverrouillé en battant le niveau 1). Vos dettes vous rattrapent : vous voilà Cuisinier d'un labo de cocaïne au fond de la jungle colombienne, et il va falloir s'évader. La jungle envoie fourmis rouges, araignées, serpents, singes, singes hurleurs (qui bombardent à distance), crocodiles et jaguars. Au bout de 10 minutes, **l'Hippo de Pablo** débarque : charges, coups de patte au sol, mortier de boulettes de dollars (les zones d'impact s'affichent au sol — esquivez !)… et dès qu'une 🍉 pastèque pousse au centre de la carte, il plonge et nage la dévorer, tête seule hors de l'eau et invulnérable tant qu'il nage : détruisez-la avant lui, sinon gros soin. L'XP se ramasse en 💵 dollars, les 🥟 empanadas rendent toute la vie, et le bonus de carte est un 💊 sachet de coke (+55% de vitesse pendant 8 s). Dans ce niveau, les améliorations d'armes changent aussi leur motif de tir (plus de balles, plus de directions, plus de portée…).

Des bonus apparaissent parfois sur la carte, comme le 🧲 **aimant** (niveau 1) qui attire d'un coup tout le fromage vers vous.

Astuce debug : sur l'écran titre, maintenir **H** en cliquant sur le niveau 2 l'ouvre même verrouillé.

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

### Manette (Bluetooth, Backbone, Kishi, Xbox, PlayStation…)

Détectée automatiquement dès le premier appui (Gamepad API, mappage standard). Fonctionne sur ordinateur comme sur mobile, y compris en même temps que le tactile — le dernier périphérique utilisé prend la main.

| Commande | Action |
|---|---|
| Stick gauche / croix | Se déplacer (vitesse analogique) |
| Stick droit | Viser — relâché, visée automatique sur l'ennemi le plus proche |
| A (Cross) | Commencer, reprendre, choisir une carte d'amélioration |
| Croix ou stick gauche (écran de niveau) | Naviguer entre les cartes |
| Start | Pause |
| Select | Couper le son |

Si la manette se déconnecte en pleine partie, le jeu se met en pause automatiquement.

## Armes

### Niveau 1 — la cuisine

- 🍳 **Poêle** (départ) — frappe l'ennemi le plus proche
- 🔪 **Couteau** — lancé en ligne vers la souris, transperce
- 🪓 **Hachoir** — dégâts rapides en cercle autour de vous
- 🔥 **Chalumeau** — jets de feu en croix
- ⚡ **Couteau électrique** — arc qui saute d'ennemi en ennemi
- 🥣 **Batteur à œufs** — fouets en orbite
- 🌶️ **Siphon piquant** — sauce piquante qui reste au sol
- 🍾 **Bouchon de champagne** — tir dévastateur qui ricoche sur les murs

### Niveau 2 — La cuisine de Pablo

- 🗡️ **Machette** (départ) — taillade en arc devant vous, l'arc s'élargit avec les niveaux
- 🎯 **Sarbacane** — fléchettes qui ralentissent et empoisonnent, +1 fléchette tous les 2 niveaux
- 🪢 **Fouet** — claque en cône court, gros recul, cône de plus en plus large
- 🔫 **AK-47 « Viva la revolución »** — rafale dans un cône étroit, +1 balle par niveau
- 💣 **Grenade de la Liberté** — explose là où vous visez ; évolue en rebonds multi-directions, puis met le feu au sol (niveau 6)
- 🔥 **Lance-flammes** — jet de feu continu vers la visée, portée croissante
- 🧴 **Maxi Repousse** — pschiiit ! nuage de pesticide en cercle autour de vous : dégâts, poison, et repousse la vermine (pas le boss ni les gros ennemis)

À chaque niveau : améliorer une arme (dégâts + cadence, et au niveau 2 le motif de tir), en prendre une nouvelle (5 max), améliorer le chef (+vitesse, +PV max), ou rarement se soigner. Le meilleur temps de chaque niveau est sauvegardé dans le navigateur (`localStorage`).

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

Dans la console du navigateur : `DEBUG.gainXp(50)`, `DEBUG.setTime(300)`, `DEBUG.godMode()`, `DEBUG.info()`, `DEBUG.boss()`, `DEBUG.killBoss()`, `DEBUG.level(2)`, `DEBUG.strong()` / `DEBUG.strong2()`, `DEBUG.unlock()`, `DEBUG.coke()`.

Sur l'écran titre : maintenir **H** en cliquant sur le bouton du niveau 2 pour l'ouvrir sans avoir battu le niveau 1.
