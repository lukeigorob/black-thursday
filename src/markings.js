// Each B-17's own markings, as the records have her, painted on the full and mid-detail models (the ones
// near you; far off they'd be less than a pixel): the group's symbol high on the fin (the 1st Bomb Wing's
// triangle, the 4th's square, each with the group's letter, in white as on the olive drab of 1943), the tail
// number below it in yellow (the serial without the first figure of its year: 42-30708 is 230708), the
// squadron code and the aircraft's letter on the fuselage sides in grey, and the recorded name in plain
// lettering on the nose. Only what's on record is painted: no serial, no tail number; no name, nothing on
// the nose. The nose art itself isn't drawn (it isn't documented), only the name.
import * as THREE from 'three';

// the group markings of the autumn of 1943 (Eighth Air Force tail symbols)
export const GROUP_SYMBOL = {
  '91st': ['triangle', 'A'], '92nd': ['triangle', 'B'], '303rd': ['triangle', 'C'], '305th': ['triangle', 'G'], '306th': ['triangle', 'H'],
  '351st': ['triangle', 'J'], '379th': ['triangle', 'K'], '381st': ['triangle', 'L'], '384th': ['triangle', 'P'],
  '94th': ['square', 'A'], '95th': ['square', 'B'], '96th': ['square', 'C'], '100th': ['square', 'D'], '385th': ['square', 'G'], '388th': ['square', 'H'], '390th': ['square', 'J'],
};

/** The tail number painted on the fin: the serial without its year's first figure (42-30708 -> 230708). */
export const tailNumber = (serial) => { const m = /^(\d)(\d)-(\d+)$/.exec(serial ?? ''); return m ? `${m[2]}${m[3]}` : null; };

const TEX = new Map(); // (one canvas a marking, shared)
function texture(key, w, h, draw) {
  if (TEX.has(key)) return TEX.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  TEX.set(key, t);
  return t;
}
const STENCIL = "'Stardos Stencil', 'Stencil', Impact, sans-serif";
function symbolTex(shape, letter) {
  return texture(`sym:${shape}:${letter}`, 256, 256, (g, w, h) => {
    g.fillStyle = '#e8e4d8';
    g.beginPath();
    if (shape === 'triangle') { g.moveTo(w / 2, 14); g.lineTo(w - 14, h - 22); g.lineTo(14, h - 22); } else g.rect(26, 26, w - 52, h - 52);
    g.fill();
    g.fillStyle = '#4b4f30'; g.font = `bold ${shape === 'triangle' ? 118 : 140}px ${STENCIL}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, w / 2, shape === 'triangle' ? h * 0.62 : h / 2 + 6);
  });
}
const textTex = (text, color, font, w = 512, h = 128) => texture(`txt:${text}:${color}:${font}`, w, h, (g) => {
  g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2 + 4);
});

/**
 * Where on this model the markings go, found once per model by casting rays at its skin from either side
 * (so they sit on the surface whatever its exact shape), in the bomber's frame (nose -Z, y up, metres: the
 * model's parent). SPOTS: name -> [z, y].
 */
// (from a scan of the model's side: the fin from y 0 to 2.5 at z 8.5-10, the fuselage's middle about y -0.8)
// (the code and the letter both aft of the star and the waist window: this model's star sits close behind
// the wing, leaving no room for the code ahead of it as on most of the real ones; the window itself is open)
const SPOTS = { fin: [9.3, 1.75], tail: [9.4, 0.85], code: [5.6, -0.55], letter: [7.4, -0.5], name: [-9.3, -0.55] };
function anchors(model) {
  if (model.userData.markAnchors) return model.userData.markAnchors;
  const frame = model.parent;
  frame.updateMatrixWorld(true);
  const meshes = []; model.traverse((o) => { if (o.isMesh && o.visible !== false && !o.userData.noShadow) meshes.push(o); });
  const mw = frame.matrixWorld, inv = new THREE.Matrix4().copy(mw).invert(), ray = new THREE.Raycaster(), out = {};
  for (const [name, [z, y]] of Object.entries(SPOTS)) {
    for (const side of [-1, 1]) {
      const from = new THREE.Vector3(side * 12, y, z).applyMatrix4(mw), dir = new THREE.Vector3(-side, 0, 0).transformDirection(mw);
      ray.set(from, dir); ray.far = 12.5;
      const hit = ray.intersectObjects(meshes, false)[0];
      if (!hit) continue;
      const p = hit.point.clone().applyMatrix4(inv);
      // the skin's facing there (kept upright: only its lean in and out, its sweep fore and aft)
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(inv) : new THREE.Vector3(side, 0, 0);
      if (n.x * side < 0.3) n.set(side, 0, 0); // (a face seen from inside, or edge-on: straight out of that side)
      out[`${name}${side}`] = { p, n: n.normalize(), side };
    }
  }
  return (model.userData.markAnchors = out);
}

const MAT = new Map();
const mat = (tex) => MAT.get(tex) ?? MAT.set(tex, new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.35, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, depthWrite: false })).get(tex);

/** Paint ident's markings on model (repainted when the model goes to another bomber, or her identity changes). */
export function applyMarkings(model, ident) {
  if (!model?.parent) return;
  const key = ident ? `${ident.group}|${ident.serial}|${ident.code}|${ident.nickname}` : '';
  if (model.userData.markKey === key) return;
  model.userData.markKey = key;
  model.userData.markings?.removeFromParent();
  if (!ident?.group) return;
  const at = anchors(model), g = new THREE.Group(); g.name = 'markings';
  model.updateMatrix(); g.matrixAutoUpdate = false; g.matrix.copy(model.matrix).invert(); // (in the bomber's frame, though hung on the model)
  const put = (spot, tex, w, h) => {
    for (const side of [-1, 1]) {
      const a = at[`${spot}${side}`];
      if (!a) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat(tex));
      // facing out of the skin, upright, reading towards the nose on the right side and the tail on the left
      // (as you look at either side), held a few centimetres off it so a curve doesn't swallow its edges
      const up = new THREE.Vector3(0, 1, 0), right = new THREE.Vector3().crossVectors(up, a.n).normalize(), up2 = new THREE.Vector3().crossVectors(a.n, right);
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up2, a.n));
      m.position.copy(a.p).addScaledVector(a.n, 0.05);
      m.renderOrder = 3; m.castShadow = false; m.receiveShadow = true;
      g.add(m);
    }
  };
  const sym = GROUP_SYMBOL[ident.group];
  if (sym) put('fin', symbolTex(...sym), 0.95, 0.95);
  const tail = tailNumber(ident.serial);
  if (tail) put('tail', textTex(tail, '#e3c03a', `bold 104px ${STENCIL}`), 1.5, 0.38);
  const [code, letter] = (ident.code ?? '').split('-');
  if (code) put('code', textTex(code, '#c9c9bd', `bold 112px ${STENCIL}`, 256, 128), 1.3, 0.65);
  if (letter) put('letter', textTex(letter, '#c9c9bd', `bold 112px ${STENCIL}`, 128, 128), 0.8, 0.8);
  if (ident.nickname) put('name', textTex(ident.nickname, '#eeeadf', 'italic bold 64px Georgia, serif', 768, 128), 1.8, 0.3);
  model.add(g);
  model.userData.markings = g;
}
