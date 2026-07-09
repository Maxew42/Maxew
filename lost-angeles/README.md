# 🏎️ Lost Angeles

Course de karts 3D post-apocalyptique, 100 % frontend — aucun serveur.
Style Mario Kart : 8 pilotes, caisses d'objets, missiles, drift et coups bas.

## Jouer

Servir le dossier avec n'importe quel serveur statique :

```bash
cd lost-angeles
python3 -m http.server 8000
# → http://localhost:8000
```

(Les modules ES ne se chargent pas en `file://`. En production, HTTPS requis
pour l'installation PWA et le multijoueur.)

## Multijoueur sans infra

- **Trystero** (WebRTC) avec signalisation via des relais **Nostr publics** :
  aucun serveur à héberger.
- Un joueur clique « Créer un salon » → code à 4 caractères → les autres
  saisissent le code et rejoignent.
- L'hôte (déterministe : plus petit id de pair) lance la course, simule les IA
  qui complètent la grille à 8, et migre automatiquement si l'hôte part.
- Synchro : chaque client simule son propre kart (15 Hz d'envoi d'état,
  interpolation à 120 ms chez les autres) ; les dégâts sont appliqués par la
  machine de la victime (« victim-authoritative »).

## Contrôles

| | Accélérer | Freiner | Tourner | Drift | Objet | Rétroviseur |
|---|---|---|---|---|---|---|
| **Clavier** | ↑ / W | ↓ / S | ←→ / AD | Espace / Maj | E / Ctrl | C |
| **Manette** | RT / A | LT / B | Stick / Croix | RB / LB | X / Y | stick droit ↓ (ou L3/R3) |
| **Tactile** | auto | FREIN | joystick | DRIFT | 🎁 (ou la case objet) | 👀 |

Échap / Start : quitter la course. Le drift chargé donne un mini-turbo
(2 paliers). Pendant le décompte, accélérer au bon moment donne un départ
canon — trop tôt et le moteur se noie.

## Les 7 pilotes

| Pilote | Véhicule | Profil |
|---|---|---|
| Michael Shoe Maker | une basket de course | très agile |
| Max Veramoitiestaplein | monoplace | vitesse max, accélération faible |
| Nein Nein | taxi jaune NY | robuste, équilibré |
| Rob Fury | bus blindé | très lourd, pousse tout le monde |
| Nails Wheels | berline | polyvalent |
| Lee Tranchey | muscle car | lourd et rapide |
| Shark Leclair | bolide rouge à aileron | léger et vif |

## Les 8 objets des caisses

| | Objet | Effet |
|---|---|---|
| 🔥 | Nitro | boost de vitesse |
| 🚀 | Missile téléguidé (rare) | poursuit le 1ᵉʳ le long de la piste, grosse explosion |
| 🗡️ | Lance explosive | file tout droit (vers l'arrière avec le rétroviseur), portée limitée |
| 📌 | Clous | piège posé au sol → tête-à-queue |
| 🪚 | Scies latérales | 6 s de scies qui éjectent les voisins |
| 🪝 | Grappin | tire un crochet tout droit ; s'il accroche un kart (≤ 38 m), téléportation juste derrière lui — sinon c'est raté |
| 💩 | Bombe de caca | la foule salit l'écran de tous les karts devant vous |
| 🛡️ | Blindage | invincible + légèrement plus rapide, éjecte au contact |

Le tirage dépend du rang : les derniers reçoivent les meilleurs objets.

## Technique

- **Three.js** (vendu dans `lib/`), rendu low-poly, tout est procédural :
  piste (spline fermée seedée — même seed → même piste chez tous), ruines,
  carcasses, textures canvas, sons synthétisés WebAudio. Zéro asset externe.
- **PWA installable** : `manifest.webmanifest` + service worker (jouable
  hors-ligne en solo).
- IA avec trajectoires personnalisées, évitement des pièges et rubber-band.
