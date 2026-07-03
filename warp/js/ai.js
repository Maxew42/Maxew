import { angleTo, clamp, dist2, wrapAngle } from './util.js';

export function updateAiPilot(ship, dt, game) {
  if (ship.dead) return idle();
  const target = nearestTarget(ship, game);
  if (!target) return idle();

  const dx = target.x - ship.x;
  const dy = target.y - ship.y;
  const desired = Math.atan2(dx, -dy);
  let delta = angleTo(ship.angle, desired);

  const avoid = asteroidAvoidance(ship, game);
  delta = wrapAngle(delta + avoid * 0.75);

  const range = Math.hypot(dx, dy);
  const aligned = Math.abs(delta) < 0.28;
  const broadside = Math.abs(delta) < 0.62;
  const controls = {
    turn: clamp(delta * 2.6, -1, 1),
    thrust: range > 190 ? 1 : 0.35,
    brake: range < 120 ? 0.7 : 0,
    primary: aligned || range < 260 && broadside,
    secondary: aligned && range > 170 && range < 720 && game.time % 1.7 < 0.35,
    boost: range > 460 && Math.abs(delta) < 0.55 && ship.energy > ship.maxEnergy * 0.45,
    utility: ship.energy > 8 && incomingMissile(ship, game),
  };
  if (avoid) {
    controls.thrust = 0.65;
    controls.brake = 0.25;
  }
  return controls;
}

function idle() {
  return { turn: 0, thrust: 0, brake: 0, primary: false, secondary: false, boost: false, utility: false };
}

function nearestTarget(ship, game) {
  let best = null;
  let bestD = Infinity;
  for (const other of game.allShips()) {
    if (other === ship || other.dead) continue;
    if (other.ai && ship.ai) continue;
    const d = dist2(ship.x, ship.y, other.x, other.y);
    if (d < bestD) {
      bestD = d;
      best = other;
    }
  }
  return best;
}

function asteroidAvoidance(ship, game) {
  let steer = 0;
  const fwdX = Math.sin(ship.angle);
  const fwdY = -Math.cos(ship.angle);
  const rightX = Math.cos(ship.angle);
  const rightY = Math.sin(ship.angle);
  for (const asteroid of game.asteroids) {
    const dx = asteroid.x - ship.x;
    const dy = asteroid.y - ship.y;
    const ahead = dx * fwdX + dy * fwdY;
    if (ahead < 0 || ahead > 260) continue;
    const side = dx * rightX + dy * rightY;
    const clear = asteroid.r + ship.radius + 38;
    if (Math.abs(side) < clear) steer -= Math.sign(side || 1) * (1 - Math.abs(side) / clear);
  }
  return clamp(steer, -1, 1);
}

function incomingMissile(ship, game) {
  return game.projectiles.some(p => p.type === 'missile' && p.ownerId !== ship.id && dist2(p.x, p.y, ship.x, ship.y) < 360 * 360);
}
