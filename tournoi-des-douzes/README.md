# Le Tournoi des Douzes

Jeu de cartes médiéval, en français, jouable au navigateur : solo contre l'IA ou
de deux à six joueurs en pair-à-pair. Aucun serveur de jeu, aucune dépendance à
installer — des fichiers statiques et des modules ES.

Chaque joueur possède le même paquet de douze combattants numérotés de 1 à 12.
À chaque manche, on pose trois cartes face cachée : une dans l'arène, une sur le
champ de joute à sa gauche, une sur celui à sa droite. Tout est révélé d'un coup,
les effets se résolvent dans l'ordre, et la carte la plus forte de chaque champ
rapporte un trophée. Dix manches, et le plus riche l'emporte.

## Structure

```
index.html                 écran unique : menus, salon, plateau, styles
js/cards.js                les douze combattants (force, effet, image)
js/rules.js                résolution d'une manche — module pur, sans DOM
js/engine.js               état de la partie : paquets, mains, défausses, manches
js/ai.js                   IA : elle simule ses six coups possibles et garde le meilleur
js/session.js              solo / hôte / pair — une même interface pour l'affichage
js/net.js                  WebRTC via Trystero (signalisation par relais Nostr)
js/board.js                géométrie de la table et rendu du plateau
js/play.js                 main, glisser-déposer, relecture pas à pas de la manche
js/dnd.js                  glisser-déposer maison en Pointer Events
js/main.js                 écrans, réglages, salon, assemblage
cards/*.webp               cartes redressées, prêtes pour le web
assets/*.jpeg              photos d'origine (source des cartes)
tools/extract_cards.py     extraction et redressement des cartes
tools/make_og.py           vignette de la page d'accueil
tools/harness.mjs          banc d'essai des règles, du moteur, de l'IA et du réseau
```

## Développement

Servir le dossier en statique suffit :

```sh
python3 -m http.server 8080     # puis http://localhost:8080/
```

Après toute retouche des règles, du moteur ou de l'IA :

```sh
node tools/harness.mjs
```

Le banc d'essai couvre chaque carte cas par cas, simule quatre cents parties
complètes pour vérifier les invariants (douze cartes par joueur du début à la
fin, dix manches, trois cartes en main à chaque manche), mesure que l'IA bat
nettement le hasard, et rejoue le protocole multijoueur sur un faux transport.

Les cartes sont extraites de photos d'écran :

```sh
python3 tools/extract_cards.py --debug   # cards/*.webp + icônes PWA
```

Le script isole le rectangle de la carte, corrige la perspective, nettoie le
moiré de la dalle LCD et exporte en WebP. Un cas particulier est traité : la
photo du Père Pair a été prise pendant une lecture vidéo et sa barre de contrôle
recouvrait le liseré du bas, qui est recollé depuis une autre carte.

## Règles retenues

Les textes des cartes (`assets/`) font foi. Deux écarts avec la feuille de règles
imprimée sont assumés et documentés dans `js/rules.js` :

- **Gontran (6)** — la feuille le résout après le combat (ancienne version où il
  s'échangeait avec la défausse). La carte en fait un modificateur de force, donc
  il est résolu avant le combat.
- **Tracassin (9)** — la feuille lui fait lancer un dé. La carte lui fait
  rapporter un trophée en cas de défaite ; c'est cette version qui est jouée, et
  les deux dés du matériel ne servent plus.

La règle « aucun effet ne s'applique dans l'arène, sauf Henriette » est précisée
ainsi : les effets qui modifient le *combat* (force, échange, victoire
automatique) ne partent que d'un champ de joute ; ceux qui ne touchent qu'au
*décompte des trophées* — David (1), Tracassin (9), Quasi-Maximus (11) — comptent
partout, arène comprise, ce que dit leur propre texte.

Enfin, la carte Quasi-Maximus porte par erreur le texte de Gontran ; c'est
l'effet de la feuille de règles qui est appliqué.

## Multijoueur

Le navigateur au plus petit identifiant fait l'hôte : il détient le seul état
autoritaire, envoie à chaque joueur sa vue privée (sa main, et rien de plus),
reçoit les placements, résout la manche et diffuse le compte rendu que tout le
monde rejoue à l'identique. Aucune IA ne remplace un siège vide ; si un joueur
s'en va, le tournoi s'interrompt.
