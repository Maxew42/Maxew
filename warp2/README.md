# Warp II

2D spaceship battle game: build your ship lego-style, then fight AI or friends.

**Static files only — no backend.** Multiplayer uses [Trystero](https://github.com/dmotz/trystero)
(P2P WebRTC, signalling over public Nostr relays), same stack as lost-angeles.
Serve the folder from any static host (or `python3 -m http.server`) and it works.

## Gameplay

- **Ships are lego**: built on three stacked 11×11 decks. Mid deck = hull blocks,
  reactors, energy cells. Top/bottom decks = cockpits and weapons (they need hull
  under them). Budget of 2000 credits per ship; at least one cockpit required.
- **Energy** powers shields (incoming damage is blocked while you have energy),
  boost (Shift) and energy beams. It regenerates over time; energy cells add more.
- **Damage is physical**: every hit lands on a specific part. Parts crack, darken,
  and blow off. Losing a reactor slows you down; parts disconnected from the
  cockpit detach; losing all cockpits destroys the ship.
- **Weights matter**: mass vs reactor thrust drives acceleration and turn rate.
- **Weapons**: machine gun, energy beam, homing missiles (fooled by flares),
  unguided rockets, 360° auto turrets, mine launcher, flare launcher.
- **Arena** has asteroids (cover + collision damage) generated from the room seed.
- **Ramming hurts**: ship-ship impacts above ~140 speed damage both hulls at the
  contact point, mass-weighted — a heavy ship crushes a light one.

## Modes

- **Battle vs AI** — 1–3 bots, three difficulties, works offline.
- **Multiplayer** — create a room, share the 4-letter code. Host can add AI bots.
  The lowest peer id is host (deterministic, survives host leaving).
- **Ship builder** — deck tabs, rotate (R), flip top/bottom decks, save designs
  (localStorage), test flight vs AI.

## Controls

| Input    | Action |
|----------|--------|
| W/↑ A/D  | thrust / turn |
| Space    | guns + energy beams |
| E        | missiles + rockets |
| X        | drop mine |
| F        | flares |
| Shift    | boost (drains energy) |
| Gamepad  | left stick aims · RT thrust · ✕ guns · □ missiles · ○ mines · △ flares · L1 boost |
| Touch    | virtual joystick + FIRE/MSL/MINE/FLARE/BOOST buttons |

Matches are deathmatch with respawns — first to 5 kills wins (vs AI and multiplayer).

## Netcode

Each client is authoritative over its own ship's damage. Weapon fire is simulated
from state-snapshot flags on every client; discrete events (`dmg`, `destroy`,
`die`, `spawn`) sync the results. Host simulates bots and broadcasts their state.

Installable as a PWA (manifest + service worker, registered on https only).
