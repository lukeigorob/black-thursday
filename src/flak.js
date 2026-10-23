// Flak: 88 mm shells bursting at the formation's height. A flash, then a black cloud that hangs in the
// air (and drifts aft past the bombers). Bombers near a burst take shrapnel; a close one can be fatal.
// The mission switches it on (`flak.on`) while the formation is over the flak belt round the target.
import * as THREE from 'three';
import { PARTS } from './bomber.js';

const V = THREE.Vector3;
const rand = (a, b) => a + Math.random() * (b - a);
const LETHAL = 45; // m: shrapnel reaches this far

export class Flak {
  constructor({ effects, audio, ui, bombers, playerBomber, onBomberHit }) {
    Object.assign(this, { effects, audio, ui, bombers, playerBomber, onBomberHit });
    this.timer = 0;
    this.active = false;
    this.on = false;
  }

  update(dt) {
    const on = this.on;
    if (on !== this.active) {
      this.active = on;
      this.ui.log(on ? 'Flak! Flak dead ahead!' : "We're through the flak.");
    }
    if (!on || (this.timer -= dt) > 0) return;
    // the gunners below fire at the part of the stream around us; bursts come in bunches
    this.timer = rand(0.25, 1.1);
    const near = this.bombers.filter((b) => !b.down && b.base.distanceTo(this.playerBomber.base) < 1500);
    const aimed = near[Math.floor(Math.random() * near.length)]; // (any bomber in range: yours no likelier than the rest)
    if (!aimed) return;
    // predicted fire: the error is mostly in height and range
    const at = aimed.group.position.clone().add(new V(rand(-90, 90), rand(-70, 70), rand(-140, 140)));
    this.burst(at);
  }

  burst(at) {
    this.effects.flakBurst(at);
    const d = at.distanceTo(this.playerBomber.group.position);
    this.audio.flak(d);
    for (const b of this.bombers) {
      if (b.down || b.gone) continue;
      const dist = at.distanceTo(b.group.position);
      if (dist > LETHAL + 20) continue;
      // shrapnel: the parts nearest the burst take most of it
      const local = b.group.worldToLocal(at.clone());
      const near = PARTS.map((p) => {
        const c = new V().set(THREE.MathUtils.clamp(local.x, p.box[0], p.box[1]), THREE.MathUtils.clamp(local.y, p.box[2], p.box[3]), THREE.MathUtils.clamp(local.z, p.box[4], p.box[5]));
        return { p, c, d: c.distanceTo(local) };
      }).filter((x) => x.d < LETHAL).sort((x, y) => x.d - y.d);
      for (const { p, c, d: pd } of near.slice(0, 4)) {
        const hits = Math.round(rand(0, 1) * (1 - pd / LETHAL) * (pd < 10 ? 14 : 6));
        for (let i = 0; i < hits; i++) {
          b.hit(p, pd < 8);
          this.onBomberHit?.(b, p, c, pd < 8, new V((p.box[0] + p.box[1]) / 2, (p.box[2] + p.box[3]) / 2, (p.box[4] + p.box[5]) / 2).sub(c)); // (the shrapnel flies in from the burst)
        }
        if (hits && b === this.playerBomber) this.audio.impact(pd < 10);
      }
    }
  }
}
