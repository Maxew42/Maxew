# Final Frontier 🚀

A cute, chill 2D **Kerbal Space Program**. Start as a kid with a soda-bottle rocket
in the backyard and grow into the best rocket company in the world — one launch at a time.

- **Assemble** a rocket from snap-together parts (nose, tanks, engines, fins, decouplers, chutes, capsules).
- **Launch** it and fly it yourself: throttle, steer, stage, deploy parachutes, warp time.
- **Climb** as high as you can. Altitude and milestones earn **XP**, which unlocks new part tiers.
- Real-ish orbital tools — **Δv**, **TWR**, live **apoapsis / periapsis**, and a **map view** with your
  predicted trajectory — so you can *actually* reach a stable orbit and beyond.

100% front-end. Progress is saved in your browser. Works offline (PWA).

## Progression tiers

| Tier | Theme | Goal |
|---|---|---|
| 🧒 Backyard | Water-pressure bottle rocket | See how high it flies |
| 🎓 Student Club | Aluminium airframes, solid motors, chutes | Controlled flight + safe recovery |
| 🚀 Startup | Liquid engines | Cross the Kármán line (touch space) |
| 🛰️ New Space | Multi-stage machines | Reach a **stable orbit** |
| 🌙 National Program | Crewed giants | Send a crew to the **Moon** |

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Steer | ← / → (or A / D) | ⟲ / ⟳ |
| Throttle | Shift / Ctrl (X = cut, Z = full) | ▲ / ▼ |
| Stage / separate | Space | STAGE |
| Map view | M | 🗺️ |
| Time warp | , / . | ⏩ |
| SAS (hold attitude) | T | SAS |

## Physics notes

The world is a toy planet (R = 250 km, g₀ = 9.8, atmosphere to 45 km, "space" at 50 km) tuned
so that a well-built rocket needs ≈ 2.3 km/s of Δv to orbit — small enough to be beginner-friendly,
KSP-flavoured enough to feel real. Gravity is true inverse-square two-body, so orbits are real conic
sections; the map view forward-integrates your coasting path.

## Layout

```
index.html            app shell, screens, styles
js/constants.js       planet physics + progression config
js/util.js            maths / formatting helpers
js/parts.js           part catalogue, staging, Δv / TWR, blueprints
js/rocket.js          stacking layout + cute canvas rendering
js/sim.js             pure flight physics (gravity, drag, staging, orbits)
js/save.js            localStorage progress (XP, unlocks, designs)
js/editor.js          the assembly bay (palette, stack, stats)
js/flight.js          the launch (camera, world art, HUD, map, controls)
js/main.js            screens / menus / glue
sw.js                 offline app-shell cache
```
