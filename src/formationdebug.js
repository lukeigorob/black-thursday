// A developer's look at the formation (?debug=formation in the link; never shown otherwise): every
// bomber's slot and who it keeps station on, how far each is out of its slot, the force's numbers by
// division, wing and group, and cameras framing the whole force, a division, a combat wing, a group, a
// squadron, or one B-17 and its neighbours. Keys (only in this mode): , and . change the view, [ and ]
// change which bomber the view is built round, \ hides the overlay.
import * as THREE from 'three';
import { LAYOUT, HISTORICAL_LAYOUT, TOTALS } from './oob.js';

export const formationDebugOn = new URLSearchParams(location.search).get('debug') === 'formation';
const VIEWS = ['normal', 'force', 'division', 'wing', 'group', 'squadron', 'neighbours'];

export class FormationDebug {
  constructor(scene, camera, bombers) {
    Object.assign(this, { scene, camera, bombers });
    this.view = 0; this.sel = 0; this.shown = true;
    // the slots (small points) and a line from each bomber to the one it keeps station on
    this.slotPts = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(bombers.length * 3), 3)),
      new THREE.PointsMaterial({ color: 0x44ff66, size: 6, sizeAttenuation: false, depthTest: false, fog: false }));
    this.links = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(bombers.length * 6), 3)),
      new THREE.LineBasicMaterial({ color: 0xffcc33, depthTest: false, transparent: true, opacity: 0.7, fog: false }));
    for (const o of [this.slotPts, this.links]) { o.frustumCulled = false; o.renderOrder = 10; scene.add(o); }
    this.box = document.createElement('pre');
    Object.assign(this.box.style, { position: 'fixed', left: '12px', bottom: '12px', margin: 0, padding: '8px 10px', maxHeight: '60vh', overflow: 'auto', zIndex: 30,
      font: '12px/1.35 ui-monospace, Consolas, monospace', color: '#d8ffd0', background: '#000c', border: '1px solid #4f4', whiteSpace: 'pre', pointerEvents: 'none' });
    document.body.append(this.box);
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key === '.') this.view = (this.view + 1) % VIEWS.length;
      else if (e.key === ',') this.view = (this.view + VIEWS.length - 1) % VIEWS.length;
      else if (e.key === ']') this.sel = (this.sel + 1) % bombers.length;
      else if (e.key === '[') this.sel = (this.sel + bombers.length - 1) % bombers.length;
      else if (e.key === '\\') this.shown = !this.shown;
    });
    this.t = 0;
  }

  /** The bomber b keeps station on: its element's lead, else its squadron's, else its group's (null: it leads the group). */
  leaderOf(b) {
    const u = b.unit;
    if (!u || b.lead) return null;
    const same = (x) => !x.down && !x.gone && x.squad === b.squad && x !== b;
    const el = this.bombers.find((x) => same(x) && x.unit?.squadron === u.squadron && x.unit?.element === u.element && x.unit?.wingman === 0);
    if (el && u.wingman !== 0) return el;
    return this.bombers.find((x) => same(x) && x.unit?.squadron === u.squadron && x.unit?.element === 0 && x.unit?.wingman === 0 && x !== b)
      ?? this.bombers.find((x) => same(x) && x.lead) ?? null;
  }

  /** The bombers a view frames, round the selected one. */
  members(view) {
    const s = this.bombers[this.sel], u = s.unit ?? {};
    const live = this.bombers.filter((b) => !b.gone);
    if (view === 'force') return live;
    if (view === 'division') return live.filter((b) => b.unit?.division === u.division);
    if (view === 'wing') return live.filter((b) => b.unit?.wing === u.wing);
    if (view === 'group') return live.filter((b) => b.squad === s.squad);
    if (view === 'squadron') return live.filter((b) => b.squad === s.squad && b.unit?.squadron === u.squadron);
    return live.filter((b) => b.group.position.distanceTo(s.group.position) < 160);
  }

  update(dt) {
    const bs = this.bombers, sp = this.slotPts.geometry.attributes.position, ln = this.links.geometry.attributes.position;
    for (const [i, b] of bs.entries()) {
      sp.setXYZ(i, b.home.x, b.home.y, b.home.z);
      const l = b.down || b.gone ? null : this.leaderOf(b);
      ln.setXYZ(i * 2, b.group.position.x, b.group.position.y, b.group.position.z);
      ln.setXYZ(i * 2 + 1, (l ?? b).group.position.x, (l ?? b).group.position.y, (l ?? b).group.position.z);
    }
    sp.needsUpdate = ln.needsUpdate = true;
    this.slotPts.visible = this.links.visible = this.shown;
    this.box.style.display = this.shown ? 'block' : 'none';
    if ((this.t -= dt) > 0) return;
    this.t = 0.5;
    this.box.textContent = this.report();
  }

  report() {
    const bs = this.bombers, live = bs.filter((b) => !b.down && !b.gone), s = bs[this.sel], u = s.unit ?? {};
    const count = (f) => live.filter(f).length;
    const groups = new Map();
    for (const b of bs) { const k = `${b.unit?.wing ?? '?'} CW  ${b.squad}  ${b.unit?.group ?? '?'}${b.unit?.part ? `-${b.unit.part}` : ''}`; const g = groups.get(k) ?? groups.set(k, { n: 0, up: 0, off: 0 }).get(k); g.n++; if (!b.down && !b.gone) { g.up++; if (b.straggling) g.off++; } }
    const err = live.map((b) => b.group.position.distanceTo(b.home)).sort((a, c) => c - a);
    const l = this.leaderOf(s), rel = l ? s.home.clone().sub(l.home) : null;
    const lines = [
      `FORMATION INSPECTION  view: ${VIEWS[this.view]} (, .)  bomber ${this.sel + 1}/${bs.length} ([ ])  overlay (\\)`,
      `active ${live.length} of ${bs.length} (mission start ${TOTALS.all}: 1st AD ${TOTALS['1st']}, 3rd AD ${TOTALS['3rd']})   1st AD up ${count((b) => b.unit?.division === '1st')}   3rd AD up ${count((b) => b.unit?.division === '3rd')}   stragglers ${count((b) => b.straggling)}`,
      `station error: worst ${err[0]?.toFixed(1) ?? '-'} m, median ${err[Math.floor(err.length / 2)]?.toFixed(1) ?? '-'} m`,
      '',
      `SELECTED  ${s.label}   ${s.ident?.serial ?? 'serial unknown'} ${s.ident?.nickname ? `"${s.ident.nickname}"` : ''}  ${s.ident?.confidence ?? ''}`,
      `  slot: ${u.squadron ?? '?'} squadron, element ${u.element ?? '?'}, ${['lead', 'left wing', 'right wing'][u.wingman] ?? '?'}${s.lead ? '  (GROUP LEAD)' : ''}${u.estimate ? '  [group count/place ESTIMATE]' : ''}`,
      `  altitude ${((7600 + s.group.position.y) * 3.281).toFixed(0)} ft   out of slot ${s.group.position.distanceTo(s.home).toFixed(1)} m   ${s.down ? 'DOWN' : s.straggling ? 'STRAGGLING' : 'in formation'}`,
      `  keeps station on: ${l ? `${l.label} (${l.ident?.serial ?? '?'})  ${s.group.position.distanceTo(l.group.position).toFixed(0)} m away, slot offset x ${rel.x.toFixed(0)} y ${rel.y.toFixed(0)} z ${rel.z.toFixed(0)}` : 'nobody (leads the group)'}`,
      '',
      'GROUPS (wing, bombing unit, group: up / dispatched, stragglers)',
      ...[...groups].map(([k, g]) => `  ${k.padEnd(28)} ${String(g.up).padStart(2)} / ${String(g.n).padStart(2)}${g.off ? `  (${g.off} out of the box)` : ''}`),
      '',
      'HISTORY NOTES: counts 1st AD from its dispatch table (VERIFIED/PROBABLE); 3rd AD wing places and the 388th/390th',
      `counts ESTIMATE; spacing: element/vertical PROBABLE, lateral/fore-aft ESTIMATE (oob.js LAYOUT); ${LAYOUT === HISTORICAL_LAYOUT ? 'historical spacing' : 'COMPACT spacing (for the game: historically the wings flew 9 km apart and the divisions 30 mi abreast; ?spacing=historical)'}.`,
      `FORCE BOX now: ${this.forceBox()}`,
    ];
    return lines.join('\n');
  }

  /** The size of the force in the air now (the bombers still up): width x height x length, and the closest pair. */
  forceBox() {
    const up = this.bombers.filter((b) => !b.down && !b.gone), mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const b of up) { const p = b.group.position.toArray(); for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); } }
    let close = Infinity;
    for (let i = 0; i < up.length; i++) for (let j = i + 1; j < up.length; j++) close = Math.min(close, up[i].group.position.distanceTo(up[j].group.position));
    return `${(mx[0] - mn[0]).toFixed(0)} m wide x ${(mx[1] - mn[1]).toFixed(0)} m tall x ${(mx[2] - mn[2]).toFixed(0)} m long, ${up.length} bombers, closest pair ${close.toFixed(1)} m`;
  }

  /** The camera for a framing view (none for 'normal'): over and behind the bombers it frames, far enough to take them all in. */
  frame() {
    const view = VIEWS[this.view];
    if (view === 'normal') return null;
    const list = this.members(view);
    if (!list.length) return null;
    const box = new THREE.Box3();
    for (const b of list) box.expandByPoint(b.group.position);
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(150, box.getSize(new THREE.Vector3()).length() * 0.5 + 60);
    const d = r / Math.tan((this.camera.fov * Math.PI) / 360) * 0.9;
    return { at: c.clone().add(new THREE.Vector3(d * 0.35, d * 0.45, d * 0.82)), look: c };
  }
}
