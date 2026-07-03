# Warp

Modular 2D spaceship battles in a static browser app.

## Play

Serve the workspace with any static server:

```bash
cd ..
python3 -m http.server 8000
```

Then open `http://localhost:8000/warp/`.

## Features

- Build ships from layered parts: core blocks/reactors/cells, plus upper and lower cockpits or weapons.
- Localized module damage, shields powered by rechargeable energy, and mass/reactor-based handling.
- Premade ships: Needle, Bulwark, Manta, and Prism.
- Solo skirmishes against AI, or serverless WebRTC rooms through Trystero/Nostr.
- Asteroid arena, missiles, beams, turrets, mines, flares, touch controls, gamepad input, and offline-capable PWA shell.
