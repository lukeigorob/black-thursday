// Markers over the fighters: red for Bf 109s, blue for P-51s (so you don't shoot a friend), with the
// range. On a gun, enemies within range also get a lead marker: where to aim so the rounds meet them.
// Everything is drawn on one 2D canvas over the game, redrawn each frame (no DOM churn).
import * as THREE from 'three';
import { BALLISTICS } from './weapons.js';

const V = THREE.Vector3;
const MAX_RANGE = 2500, LEAD_RANGE = 1000; // m
const COLOURS = { axis: [255, 74, 58], allied: [80, 170, 255] };
const SIM_STEP = 1 / 240; // s: bullet flight is integrated like the real rounds (drag, gravity, wind)

const _p = new V(), _aim = new V(), _dir = new V(), _b = new V(), _v = new V(), _err = new V();

/**
 * Where to aim (world space) from `from` so a round meets a target now at `pos` moving at `vel`.
 * Iterates: guess the flight time, aim at where the target will be, fly a simulated round there,
 * then correct the aim by how far that round missed (drop, drift in the airstream).
 */
export function leadPoint(from, pos, vel, out = new V()) {
  const { MUZZLE_SPEED, GRAVITY, DRAG, WIND } = BALLISTICS;
  let t = from.distanceTo(pos) / MUZZLE_SPEED;
  out.copy(pos).addScaledVector(vel, t);
  _err.set(0, 0, 0);
  for (let it = 0; it < 3; it++) {
    const meet = _p.copy(pos).addScaledVector(vel, t); // where the target will be
    _aim.copy(meet).sub(_err);
    _dir.subVectors(_aim, from).normalize();
    // fly a round at the aim point until it is as far out as the meeting point
    const range = from.distanceTo(meet);
    _b.copy(from); _v.copy(_dir).multiplyScalar(MUZZLE_SPEED);
    let s = 0;
    while (s < 3 && _b.distanceTo(from) < range) {
      const rx = _v.x - WIND.x, ry = _v.y - WIND.y, rz = _v.z - WIND.z;
      const k = DRAG * Math.hypot(rx, ry, rz) * SIM_STEP;
      _v.x -= rx * k; _v.y -= ry * k + GRAVITY * SIM_STEP; _v.z -= rz * k;
      _b.addScaledVector(_v, SIM_STEP);
      s += SIM_STEP;
    }
    t = s;
    _err.add(_b.sub(_p.copy(pos).addScaledVector(vel, t))); // how far it missed where the target got to
    out.copy(pos).addScaledVector(vel, t).sub(_err);
  }
  return out;
}

export class Tags {
  constructor() {
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
    document.getElementById('hud').prepend(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.cam = new V(); this.scr = new V(); this.lead = new V();
  }

  /** fighters: the Fighters list; onGun: draw lead markers too. */
  update(camera, fighters, onGun) {
    const c = this.canvas, g = this.g, dpr = Math.min(devicePixelRatio, 2);
    const w = innerWidth, h = innerHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    camera.getWorldPosition(this.cam);
    g.font = '600 11px system-ui, sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 1.5;
    for (const f of fighters) {
      if (!f.alive) continue;
      const d = f.pos.distanceTo(this.cam);
      if (d > MAX_RANGE) continue;
      const s = this.toScreen(f.pos, camera, w, h);
      if (!s) continue;
      const [r, gr, b] = COLOURS[f.side];
      const a = THREE.MathUtils.clamp(1 - (d - 600) / (MAX_RANGE - 600) * 0.65, 0.35, 1);
      const col = `rgba(${r},${gr},${b},${a})`;
      g.strokeStyle = g.fillStyle = col;
      // a small down-pointing triangle above the plane, plus the range
      const y = s.y - 14;
      g.beginPath(); g.moveTo(s.x - 5, y - 6); g.lineTo(s.x + 5, y - 6); g.lineTo(s.x, y); g.closePath(); g.stroke();
      g.fillText(d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`, s.x, y - 9);
      if (onGun && f.side === 'axis' && d < LEAD_RANGE) {
        leadPoint(this.cam, f.pos, f.velocity, this.lead);
        const l = this.toScreen(this.lead, camera, w, h);
        if (!l) continue;
        g.strokeStyle = `rgba(255,74,58,${Math.min(1, a + 0.2)})`;
        g.setLineDash([3, 3]); g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(l.x, l.y); g.stroke(); g.setLineDash([]);
        g.beginPath(); g.arc(l.x, l.y, 7, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.arc(l.x, l.y, 1.5, 0, Math.PI * 2); g.fill();
      }
    }
  }

  /** Screen position in CSS pixels, or null when behind the camera / off screen. */
  toScreen(p, camera, w, h) {
    // behind the camera? (tested directly: with the reversed depth buffer, projected z isn't a reliable test)
    camera.getWorldDirection(this.fwd ??= new V());
    if (this.scr.copy(p).sub(this.cam).dot(this.fwd) <= 0.5) return null;
    const s = this.scr.copy(p).project(camera);
    if (Math.abs(s.x) > 1.1 || Math.abs(s.y) > 1.1) return null;
    return { x: (s.x + 1) / 2 * w, y: (1 - s.y) / 2 * h };
  }

  clear() { this.g.clearRect(0, 0, this.canvas.width, this.canvas.height); }
}
