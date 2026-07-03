// Pilotes IA : suivent la piste avec une personnalité, évitent les pièges,
// utilisent leurs objets et bénéficient d'un léger élastique (rubber-band).
import { clamp, angleDelta } from './util.js';

export class AIDriver {
  constructor(kart, track, rng) {
    this.kart = kart;
    this.track = track;
    this.rng = rng;
    this.lineOffset = (rng() - .5) * .9;        // position préférée sur la route
    this.skill = .94 + rng() * .07;             // vitesse de pointe relative
    this.baseVmax = kart.vmax;
    this.itemTimer = 1.5 + rng() * 4;
    this.startDelay = .15 + rng() * .7;
    this.noiseT = rng() * 10;
    this.input = { steer: 0, throttle: 0, brake: 0, drift: false, item: false };
  }

  think(dt, world) {
    const k = this.kart, t = this.track;
    const inp = this.input;
    inp.item = false;
    this.noiseT += dt;

    if (world.phase !== 'race') { inp.throttle = 0; inp.steer = 0; return inp; }
    if (this.startDelay > 0) { this.startDelay -= dt; inp.throttle = 0; return inp; }

    // point visé devant, avec offset de trajectoire personnel
    const lookM = 7 + Math.abs(k.speed) * .5;
    let targetLat = this.lineOffset * (t.halfW - 2.2);

    // éviter les clous proches
    for (const n of world.nails) {
      const d = Math.hypot(n.x - k.x, n.z - k.z);
      if (d < lookM + 4) {
        const p = t.project(n.x, n.z, k.hintIdx);
        let df = p.f - k.lastF;
        if (df > t.N / 2) df -= t.N; if (df < -t.N / 2) df += t.N;
        if (df > -2 && df < lookM / t.segLen + 4 && Math.abs(p.lat - targetLat) < 3) {
          targetLat = p.lat > 0 ? p.lat - 4 : p.lat + 4;
        }
      }
    }
    targetLat = clamp(targetLat, -(t.halfW - 1.2), t.halfW - 1.2);

    const aheadF = k.lastF + lookM / t.segLen;
    const pos = t.posAt(aheadF);
    const left = t.leftAt(aheadF);
    const tx = pos.x + left.x * targetLat, tz = pos.z + left.z * targetLat;
    const desired = Math.atan2(tx - k.x, tz - k.z);
    let steer = clamp(angleDelta(k.heading, desired) * 2.3, -1, 1);

    // écran couvert de caca → conduite hasardeuse
    if (k.poopT > 0) steer = clamp(steer + Math.sin(this.noiseT * 3.1) * .75, -1, 1);

    // frein si gros virage à haute vitesse
    const farF = k.lastF + (lookM * 2.2) / t.segLen;
    const turnAhead = Math.abs(angleDelta(t.headingAt(k.lastF), t.headingAt(farF)));
    let throttle = 1, brake = 0;
    if (turnAhead > .75 && k.speed > k.vmax * .62) { throttle = .25; brake = .35; }
    else if (turnAhead > .45 && k.speed > k.vmax * .8) throttle = .55;

    // élastique : rattrape le meneur humain, se calme devant
    const gap = world.pacerProgress - k.totalProgress; // >0 = en retard
    k.vmax = this.baseVmax * this.skill * clamp(1 + gap * .0007, .92, 1.12);

    // objets
    if (k.item && k.rouletteT <= 0) {
      this.itemTimer -= dt;
      if (this.itemTimer <= 0) {
        inp.item = true;
        this.itemTimer = 1.5 + this.rng() * 4;
      }
    }

    inp.steer = steer; inp.throttle = throttle; inp.brake = brake;
    return inp;
  }
}
