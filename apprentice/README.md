# The Apprentice ⚔️

Jeu de combat au sabre laser en 3D dans un Colisée — duels façon **Mount & Blade** (attaques et
parades dans 4 directions) et PvE contre des droïdes blasters. Solo ou multijoueur P2P sans serveur.

## Jouer

Servir le dossier en statique (`python3 -m http.server`) et ouvrir `index.html`. PWA installable,
jouable au clavier+souris, au tactile (mobile) et à la manette.

## Modes

- **Duel** — chacun pour soi, premier à 5 touches mortelles. Solo contre l'IA (« Maître Kaal »)
  ou en multi (jusqu'à 8 ; un duelliste IA complète si on est seul).
- **Horde** — coopération contre des vagues de droïdes blasters qui surgissent des portes.
  Un droïde = un coup de sabre. Soin +35 entre les vagues, les morts reviennent à la vague suivante.

## Combat

- **Attaque directionnelle** (haut/droite/bas/gauche) : à la souris, la direction vient du geste au
  moment du clic gauche (façon M&B) ; au tactile, on balaie l'écran droit ; à la manette, stick droit + RT.
- **Parade** (clic droit / bouton PARADE / LT) : bloque si la direction correspond à l'attaque
  (tactile et manette = parade assistée, la direction s'aligne automatiquement).
- **Parade parfaite** (< 0,28 s avant l'impact) : renvoie les tirs de blaster sur leur expéditeur,
  fait chanceler l'attaquant au sabre, annule la poussée de Force.
- La parade (face au tir) **dévie toujours** les bolts de blaster ; seul le renvoi demande le timing parfait.
- **Poussée de Force** (E / ✋ / X, 45 pts de Force) : projette et fait chanceler dans un cône — parable.
- **Saut double** (Espace ×2), **dash** (Maj) avec temps de recharge.

## Technique

Même pile que Lost Angeles / Warp II : fichiers statiques, ES modules, Three.js, Trystero
(WebRTC via relais Nostr) pour le multi sans serveur. Hôte = plus petit id de pair.

Autorité réseau : chaque client simule **son** combattant et décide des dégâts qu'il subit
(victime-autoritaire) ; l'hôte simule droïdes et duellistes IA (`bots`), les évènements discrets
(`atk`, `blk`, `hurt`, `die`, `push`, `bolt`, `refl`, `wave`…) synchronisent le combat.
Les bolts sont simulés par tous les clients à partir de l'évènement de tir.
