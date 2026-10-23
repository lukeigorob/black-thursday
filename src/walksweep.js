// A test of the walkable inside of the bomber, run with the real movement code (`game.walkSweep()`,
// or `node tools/walk-sweep.mjs`): from a grid of standing spots on every deck it walks a second
// in eight directions and reports every place you can fall through, get stuck, push your body
// through the hull, or put your eye through a wall or the roof. Then it walks the routes a player
// takes, nose to tail and back and out to every station, steering like a player, past the crew.
import * as THREE from 'three';
import { DECKS } from './interior.js';
import { CORRIDOR } from './crew.js';

const R = 0.2, STEP = 0.42, MIN_HEADROOM = 0.55, DT = 1 / 60, STEPS = 50;

export function walkSweep(player) {
  const it = player.it, saved = { feet: player.feet.clone(), safe: player.safe.clone(), yaw: player.yaw, pitch: player.pitch, enabled: player.enabled, station: player.station, keys: player.keys };
  if (player.station) player.interact();
  player.enabled = true;
  const issues = new Map(), add = (kind, p, extra = '') => {
    const key = `${kind}:${p.x.toFixed(1)}:${p.z.toFixed(1)}`;
    if (!issues.has(key)) issues.set(key, { kind, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), extra });
  };
  const cam = player.camera, start = new THREE.Vector3();
  let starts = 0, runs = 0;
  for (const d of DECKS) {
    for (let z = d.z0 + 0.15; z < d.z1 - 0.1; z += 0.3) for (let x = -d.hw; x <= d.hw + 1e-6; x += 0.2) {
      if (it.floorAt(x, z, d.y + 0.05) < d.y - 0.01) continue; // no floor there
      if (it.blocked(x, z, R, d.y + STEP, d.y + MIN_HEADROOM)) continue; // something stands there
      if (Math.abs(x) > it.wallLimit(z, d.y + 0.3, d.y + 1.2) - R) continue; // outside the hull
      if (it.headroom(x, z, d.y, R, STEP) < MIN_HEADROOM) continue;
      starts++;
      start.set(x, d.y, z);
      let moved = 0;
      for (let k = 0; k < 8; k++) {
        runs++;
        player.feet.copy(start); player.safe.copy(start); player.vel.set(0, 0, 0); player.vy = 0;
        player.camY = start.y + player.eye; // (standing there: not the eye height of wherever you were before)
        player.yaw = (k / 8) * Math.PI * 2; player.pitch = 0;
        player.keys = { KeyW: true };
        let top = start.y;
        for (let i = 0; i < STEPS; i++) {
          const before = player.feet.clone();
          player.update(DT);
          const f = player.feet;
          if (f.distanceTo(before) > 1) add('teleported back (fell out of the world)', before);
          top = player.vy === 0 ? f.y : top;
          if (top - f.y > 0.5) add('falls through', f, `from ${top.toFixed(2)}`);
          const lim = it.wallLimit(f.z, f.y + 0.3, f.y + Math.max(player.eye - 0.25, 0.35)); // (as the movement code measures it: a crouching body is lower)
          if (Math.abs(f.x) > lim + 0.02) add('body through the hull', f, `|x| ${Math.abs(f.x).toFixed(2)} > ${lim.toFixed(2)}`);
          const e = cam.position; // (bomber space: the camera rides in the bomber)
          const w = it.hwSmooth(e.z, e.y);
          if (Math.abs(e.x) > w - 0.03) add('eye in the wall', f, `eye x ${e.x.toFixed(2)} wall ${w.toFixed(2)}`);
          const roof = it.ceilingAt(e.z, e.x, f.y + 0.3);
          if (e.y > roof + 0.02) add('eye through the roof', f, `eye ${e.y.toFixed(2)} roof ${roof.toFixed(2)}`);
        }
        moved = Math.max(moved, player.feet.distanceTo(start));
      }
      if (moved < 0.05) add('stuck (cannot walk out)', start);
    }
  }
  player.keys = saved.keys; player.feet.copy(saved.feet); player.safe.copy(saved.safe); player.yaw = saved.yaw; player.pitch = saved.pitch; player.enabled = saved.enabled;
  player.vel.set(0, 0, 0); player.vy = 0;
  const list = [...issues.values()];
  const byKind = {};
  for (const i of list) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
  const routes = walkRoutes(player, add);
  const all = [...issues.values()];
  const kinds = {};
  for (const i of all) kinds[i.kind] = (kinds[i.kind] ?? 0) + 1;
  return { starts, runs, routes, total: all.length, byKind: kinds, issues: all };
}

/**
 * Walk the routes a player takes: nose to the tail gun and back along the walkway (through the doors,
 * over the steps, past the crew), then from the walkway to every station's E spot. Steers straight at
 * each point like a player holding W. Reports where you're held up over a second, or can't get to.
 */
function walkRoutes(player, add) {
  const it = player.it, done = [];
  const follow = (name, path) => {
    player.feet.copy(path[0]); player.safe.copy(path[0]); player.vel.set(0, 0, 0); player.vy = 0; player.camY = path[0].y + player.eye;
    let ok = true;
    for (const target of path.slice(1)) {
      let t = 0, best = Infinity, sinceBest = 0, flagged = false;
      while (Math.hypot(target.x - player.feet.x, target.z - player.feet.z) > 0.22) {
        player.yaw = Math.atan2(-(target.x - player.feet.x), -(target.z - player.feet.z));
        player.pitch = 0;
        player.keys = { KeyW: true };
        player.update(DT);
        t += DT;
        const d = Math.hypot(target.x - player.feet.x, target.z - player.feet.z);
        if (d < best - 0.03) { best = d; sinceBest = 0; } else sinceBest += DT;
        if (sinceBest > 1 && !flagged) { add(`held up (${name})`, player.feet.clone(), `on the way to ${target.x.toFixed(2)}, ${target.z.toFixed(2)}`); flagged = true; }
        if (t > 10) { add(`can't get there (${name})`, player.feet.clone(), `to ${target.x.toFixed(2)}, ${target.z.toFixed(2)}`); ok = false; break; }
      }
      if (!ok) break;
    }
    done.push(`${name}: ${ok ? 'ok' : 'FAILED'}`);
  };
  follow('nose to tail', CORRIDOR);
  follow('tail to nose', [...CORRIDOR].reverse());
  for (const s of it.stations) { // from the nearest point on the walkway to the station's E spot
    const near = CORRIDOR.reduce((a, c) => (c.distanceTo(s.stand) < a.distanceTo(s.stand) ? c : a));
    follow(`to the ${s.name.toLowerCase()}`, [near, s.stand]);
  }
  player.keys = {};
  return done;
}
