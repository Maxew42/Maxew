# Final Frontier

A static browser game about growing a tiny rocket company into an orbital launch program.

## Play

Open `index.html` through a local web server. Progress, company name, milestones, and rocket blueprints are saved in `localStorage`.

## Controls

- A / D or left / right arrows: pitch the rocket
- W / S or up / down arrows: throttle liquid engines
- Space: stage
- P: deploy parachutes
- M: map view
- X: time warp
- Q: SAS hold
- Escape: end flight

## Design Notes

The game is 100% frontend. Rocket stack order matters: decouplers split stages, bottom stages fire first, fuel and dry mass affect dV and TWR, and the flight model computes real apoapsis and periapsis around a small KSP-like planet.
