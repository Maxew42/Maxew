# Morentia — table de test numérique

Application entièrement frontend pour jouer et éprouver Morentia sur ordinateur
ou téléphone. Cartes, lieux, design et conventions viennent du classeur
`Morentia_cartes.xlsx` livré à la racine.

Aucun serveur de jeu, aucune étape de compilation : le dossier est publiable tel
quel par le workflow GitHub Pages du dépôt.

## Lancer localement

Les modules ES et le service worker exigent un serveur HTTP :

```bash
cd morentia2
npm run serve          # http://localhost:4174
```

## Modes de jeu

| Mode | Ce qu'il fait |
| --- | --- |
| Solo contre l'IA | Vous plus une ou deux IA qui jouent et répondent à leurs propres cartes. |
| Chacun son tour | Plusieurs humains sur un seul écran, avec un rideau entre les tours pour ne pas dévoiler les mains. |
| Multijoueur | Un seul écran : partagez votre code pour inviter, ou saisissez celui d'un ami pour le rejoindre. |

## Multijoueur pair-à-pair

Chaque navigateur porte un code de partie tiré au hasard et conservé d'une
session à l'autre. Le partager fait de vous l'hôte, et vous seul voyez le bouton
**Commencer** ; saisir celui d'un ami vous place dans son salon, où vous attendez
qu'il lance la partie.

L'hôte est le seul à exécuter le moteur. Il ne transmet pas l'état complet mais
le **flux d'événements** qui le produit : les invités replient ce flux et
obtiennent exactement le même plateau. Les invités renvoient leurs actions et
leurs réponses de carte.

La mise en relation WebRTC passe par des relais Nostr publics. Ces relais ne
voient jamais la partie — seulement les descriptions de connexion. La liste est
modifiable dans **Réglages → Relais de signalisation** ; l'écran de salon indique
combien de relais répondent.

> **Information cachée.** Le flux d'événements est diffusé intégralement, donc
> le navigateur d'un joueur connaît les mains adverses même s'il ne les affiche
> pas. C'est le prix d'un multijoueur sans serveur avec un état parfaitement
> identique partout. C'est sans conséquence pour un test entre gens de confiance ;
> ce ne conviendrait pas à une partie classée.

Autres limites connues : un joueur ne peut pas rejoindre une partie déjà
commencée, et si l'hôte quitte, la partie s'arrête.

## Cartes et classeur

- **Importer** un `.xlsx` (mêmes feuilles que le fichier source) ou un `.zip`
  contenant classeur et illustrations. L'import est conservé dans le stockage
  local du navigateur et remplace le catalogue livré.
- **Exporter** en `.xlsx` ou en paquet `.zip` complet.
- **Studio de cartes** : édition de chaque champ, remplacement d'illustration,
  et réglage du design global (couleurs de faction, police, arrondi, opacité de
  l'illustration, tailles de texte). Tout est réexporté dans la feuille `Design`.

Le même analyseur sert à l'import navigateur et à la génération du catalogue
embarqué, il ne peut donc pas y avoir de divergence entre les deux :

```bash
npm run catalog        # Morentia_cartes.xlsx → js/data/catalog-default.js
node tools/roundtrip.mjs   # vérifie qu'export puis import ne perd rien
```

## Illustrations

Chaque carte reçoit un paysage dessiné par le programme, déterministe à partir
de son identifiant : deux parties montrent toujours la même image, rien n'est
téléchargé, et le jeu reste utilisable hors-ligne. La silhouette de premier plan
suit la famille de la carte (unité, permanent, éphémère, attachement, lieu) et la
teinte suit la couleur de faction.

Dès qu'une vraie illustration existe, elle la remplace : via la colonne
`Illustration` du classeur accompagnée du fichier dans un paquet `.zip`, ou
directement dans le Studio.

## Disposition des cartes

Première ligne : le disque d'influence contre le coin haut-gauche — serré sur son
chiffre, car c'est le nombre qu'on lit d'un bout de la table, pas le disque —
puis le nom, puis les deux prix (domaine et lieu) empilés contre le coin
haut-droit pour économiser la largeur. Ensuite l'illustration, le type, le texte
de règles, et un bandeau de pied portant le code de référence du classeur
(`KAL-19`, `LIE-06`) — de quoi retrouver une carte dans la feuille sans la
chercher par son nom. Les lieux remplacent l'influence par la Durée et affichent
`Durée · Survivants · PV` en clair sous leur type. Les tailles sont exprimées en
pourcentage de la largeur de la carte, si bien qu'une carte reste lisible à
n'importe quelle échelle du plateau ; sur les vignettes réduites du plateau, le
texte et le code cèdent la place à l'illustration.

Les chiffres des pastilles ont leur propre police (`numeralFont` dans la feuille
Design). Georgia, la police par défaut des cartes, a des chiffres elzéviriens :
le 3, le 5 et le 7 descendent sous la ligne de base, le 1 et le 2 sont de hauteur
d'x. Aucun réglage ne les centre tous dans une pastille — d'où une police à
chiffres de hauteur capitale pour ces seuls emplacements.

### Mots-clés

Les mots des cartes qui portent une règle — *Guerre*, *lieu*, *Survivants*,
*épuisée*… — sont légèrement épaissis, et la vue détaillée en affiche la règle au
survol (au toucher sur téléphone). Le vocabulaire est décrit dans
`js/rules/glossary.js` : une entrée par notion, avec ses formes fléchies telles
qu'elles apparaissent sur les cartes. Quand une entrée porte un `rule`, son texte
est celui de la feuille **À lire** du classeur, qui fait foi ; le texte du module
ne sert alors que de repli. Seule la première occurrence d'une notion est marquée
par carte, et une courte liste de faux amis (`au lieu de`) évite de prendre une
tournure française pour un terme de jeu.

## Plateau

Tout ce qui n'est pas la table tient dans une **allée à gauche** : le bandeau de
partie en haut — Jour et phase, un joueur par ligne avec son or, ses PV et sa
main, puis Journal et Quitter — et sous lui le marché, en **deux colonnes de
cartes debout**. L'allée n'appartient pas au plateau et échappe donc à son zoom :
l'étalage reste lisible quelle que soit l'échelle de la table, et le plateau, qui
est borné par sa hauteur, ne perd rien à ce que l'allée soit large.

Sur un écran de téléphone (moins de 900 px) il n'y a pas de place pour une allée
permanente : le bandeau revient en barre au-dessus de la table et le marché
devient un tiroir, ouvert par le bouton **Marché** du bandeau et refermé d'une
touche sur le plateau.

Domaines adverses en haut, lieux au centre, votre domaine en bas. Le plateau
occupe toute la hauteur de la fenêtre : rien ne le pousse plus, ni barre au
dessus, ni rangée de main au-dessous.

La **main** est un jeu de cartes tenu en éventail, posé par-dessus le plateau.
Repliée, elle n'en montre que la tranche haute — nom, influence et prix, ce qui
sert à choisir. Elle se déploie au survol, au contact du doigt, et se replie
d'elle-même. Une carte est *au point* à la fois : celle qu'on survole, celle
qu'on amène du doigt en balayant l'éventail, ou celle qu'on désigne aux flèches
du clavier ; elle se redresse, monte et grandit pour être vraiment lisible.
Pendant qu'une carte est portée, la main s'écarte pour dégager la table. Votre
deck et votre défausse flottent à gauche de cette bande, votre or, vos points de
victoire et vos commandes à droite.

Les **paquets** se présentent comme de vraies piles : le deck montre son dos, la
défausse — publique — montre la carte qui la coiffe, et deux tranches décalées
donnent l'épaisseur. Un paquet vide retombe sur un emplacement en pointillés.
Le dos lui-même est dessiné par `cardBackArt` dans `js/ui/art.js` — une lune
encadrée par la porte de pierre des lieux, et les cinq phases du Jour en
couronne — et prend la couleur du paquet : votre deck, celui d'un adversaire et
le deck de marché se distinguent sans être retournés.

La **carte Base** de chaque faction est toujours visible dans le domaine de son
joueur : c'est un pouvoir permanent, pas une carte qu'on joue.

Autour de chaque lieu, **chaque camp occupe un côté** : vous en bas, vos
adversaires à gauche, à droite et en face selon leur nombre. On voit donc à qui
appartient chaque carte sans avoir à suivre une pastille de couleur. Il y a
autant de lieux actifs que de joueurs. L'intitulé d'un camp porte son nom et son
influence sur le lieu, et une **couronne** devant le nom de celui qui le tient —
la carte-lieu est en outre cernée de sa couleur. Aucune ligne de texte ne le
répète : deux lignes par rangée de lieux valent mieux à la table.

Le plateau se recadre seul tant que vous ne l'avez pas déplacé vous-même ;
molette, pincement et les boutons `+` / `−` / `⛶` permettent de cadrer.

Les cartes se jouent au **glisser-déposer**. Pendant le glissement, seules les
zones réellement licites s'allument — la légalité vient du moteur, jamais de
l'affichage.

**Lire une carte** : un clic sur n'importe quelle carte du plateau (lieu, carte
adverse, marché) l'agrandit. En main le clic sert à jouer, c'est donc la loupe du
coin de la carte qui ouvre la même vue. La pile de défausse s'ouvre d'un clic ;
le deck reste caché, y compris à son propriétaire.

## Résolution animée

Le moteur résout une phase entière instantanément. L'affichage travaille sur un
état retardé et rejoue les événements un par un, avec une pause propre à chacun,
le déplacement des cartes, les bulles d'influence et d'or, et un bandeau de
phase.

## Organisation du code

```
js/
  data/     classeur → catalogue : schéma, import/export, zip, stockage
  rules/    moteur isolé — c'est ici que les règles évoluent
    constants.js  phases, zones, réglages par défaut, Ordres
    events.js     réducteur : seul endroit qui modifie l'état
    state.js      sélecteurs purs (influence, contrôle, coûts, légalité)
    engine.js     primitives, signaux, choix suspendus
    flow.js       mise en place, enchaînement des phases, actions
    effects/      un fichier par provenance, une entrée par carte
    glossary.js   vocabulaire des cartes : mots-clés et règle associée
  ui/       cartes, illustrations, plateau, glisser-déposer, animation, studio
  ai/       adversaire artificiel
  net/      pair-à-pair WebRTC
```

**Faire évoluer les règles** revient à toucher `js/rules/`, et le plus souvent le
seul fichier `js/rules/effects/`. Chaque carte y est une entrée autonome dont les
crochets (`onDawn`, `onEnterPlace`, `aura`, `costFor`, `replaceDestroy`, …) sont
décrits en tête de `js/rules/registry.js`. Un effet ne connaît ni l'état ni
l'affichage : tout passe par `ctx`. Un effet peut interrompre sa résolution pour
poser une question (`yield ctx.pickCard(...)`), ce qui fonctionne aussi bien pour
un humain, pour l'IA que pour un joueur distant.

Comme toute modification de l'état passe par un événement, une règle nouvelle est
automatiquement animée, journalisée et synchronisée en réseau.

## Bancs d'essai

```bash
node tools/harness.mjs 40 3    # 40 parties à 3 joueurs, jouées au hasard
node tools/roundtrip.mjs       # aller-retour du classeur
```

Le banc d'essai signale les exceptions, les parties bloquées, la durée moyenne,
les PV, et surtout **les effets jamais déclenchés** — un bon indicateur de carte
injouable ou trop chère. À relancer après toute modification des règles ou du
classeur.

## Conventions retenues

Le classeur fixe les cartes ; plusieurs points restaient à trancher pour pouvoir
jouer. Ils sont regroupés dans l'écran **Règles** de l'application et rappelés
ici :

- **Ordres de Kalassir** — le classeur mentionne l'« Ordre actif » et le
  « Conseil des Trois Ordres » sans en fixer le coût. L'Ordre débute sur *Lames
  de Karina* ; en changer est une action coûtant 1 or, gratuite après un Messager
  du Conseil. Réglable dans `js/rules/constants.js`.
- **Aube** — la réserve devient or actif, les cartes se redressent, chaque joueur
  pioche 1 carte, puis les effets d'Aube se résolvent dans l'ordre du premier
  joueur. Le nombre de cartes piochées et l'or d'Aube sont dans les réglages.
- **Contrôle** — recalculé en continu et non seulement au Crépuscule : un effet
  qui change une influence peut faire basculer un lieu immédiatement, ce qui rend
  lisibles les cartes déclenchées par une prise de contrôle.
- **Lieux actifs** — le classeur conseille « joueurs + 1 » ; la table en ouvre
  autant que de joueurs, pour que chaque camp tienne un côté du lieu et que le
  plateau reste lisible. Réglable avant la partie.
- **Lieux adjacents** — les emplacements forment une rangée ; seuls les voisins
  immédiats sont adjacents, plus les deux emplacements reliés par un Réseau
  Longmai.
- **Mulligan** — la feuille « À lire » accorde une refonte gratuite de la main de
  départ ; la question posée en début de partie est ce mulligan, et elle montre
  les cartes concernées. Mettre `Mulligans` à 0 dans les réglages la supprime.
- **Deck de lieux épuisé** — les lieux déjà expirés sont remélangés. Avec neuf
  lieux au catalogue et une fin de partie à `2 × joueurs + 2` expirations, une
  partie à trois joueurs en consomme davantage que la réserve initiale.
- **Guerre** — version de la feuille « À lire » : les joueurs à la plus haute
  influence de domaine gagnent 1 or en réserve, les autres perdent 1 or actif.

Les monstres et le module Jadis ne figurent pas dans la sélection du classeur
actuel. Le moteur les gère (Seuil, expiration à la Nuit, récompenses), il suffit
de réintroduire les lignes correspondantes dans le classeur et d'activer
« Module Jadis » dans les réglages.

## PWA

`manifest.webmanifest` et `sw.js` rendent l'application installable et jouable
hors-ligne après la première visite. Le service worker sert le réseau d'abord et
le cache en secours : un rechargement pendant la mise au point donne toujours la
version fraîche.
