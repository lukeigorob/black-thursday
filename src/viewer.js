// Model viewer: check the converted GLBs (size, orientation, materials, node names and pivots).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MODELS, loadModel } from './models.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // soft via shadow.radius
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fa9c4);
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.6;

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 2000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xdfe9f5, 0x4a4436, 0.6));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.02;
sun.shadow.radius = 4;
scene.add(sun, sun.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.28 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
const grid = new THREE.GridHelper(60, 60, 0x55606c, 0x6c7884); // 1 m squares
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(ground, grid);

// arrow pointing to -Z: the nose of every plane should point this way
const nose = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(), 4, 0xff7a3c, 0.8, 0.5);
scene.add(nose);

let current = null, currentName = '', selBox = null, pivots = null, spinners = [];
const opts = { wire: false, pivots: false, spin: true };
const bar = document.getElementById('bar');
const info = document.getElementById('info');
const list = document.getElementById('nodes');

for (const [name, m] of Object.entries(MODELS)) {
  const b = document.createElement('button');
  b.textContent = m.label;
  b.dataset.model = name;
  b.onclick = () => show(name);
  bar.append(b);
}
for (const [key, label] of [['spin', 'Spin props'], ['pivots', 'Show pivots'], ['wire', 'Wireframe']]) {
  const l = document.createElement('label');
  l.innerHTML = `<input type="checkbox" ${opts[key] ? 'checked' : ''}> ${label}`;
  l.querySelector('input').onchange = (e) => { opts[key] = e.target.checked; applyOpts(); };
  bar.append(l);
}

function applyOpts() {
  if (!current) return;
  current.traverse((o) => { if (o.isMesh) o.material.wireframe = opts.wire; });
  if (pivots) pivots.visible = opts.pivots;
}

async function show(name) {
  currentName = name;
  for (const b of bar.querySelectorAll('button')) b.classList.toggle('on', b.dataset.model === name);
  info.textContent = `Loading ${MODELS[name].label}…`;
  const { scene: model, ok } = await loadModel(name);
  if (currentName !== name) return;
  if (current) scene.remove(current);
  if (selBox) { scene.remove(selBox); selBox = null; }
  current = model;

  // sit the plane on the grid so shadows read well, without changing its own origin
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  model.position.y = -box.min.y + 0.5;
  scene.add(model);

  // props / spinners to animate
  spinners = [];
  model.traverse((o) => { if (/^(Prop_\d|Nose|Fake_Blades)$/.test(o.name) && o.parent?.name !== 'Hull') spinners.push(o); });

  // small axes at every node so pivots can be checked
  pivots = new THREE.Group();
  model.traverse((o) => { if (o !== model && !o.isMesh) { const a = new THREE.AxesHelper(0.6); a.position.copy(o.getWorldPosition(new THREE.Vector3())); pivots.add(a); } });
  scene.add(pivots);

  const r = Math.max(size.x, size.z);
  camera.position.set(r * 0.75, r * 0.45, -r * 0.9); // front quarter
  controls.target.set(0, size.y / 2 + 0.5, 0);
  sun.position.set(r * 0.6, r * 1.4, r * 0.5);
  const s = sun.shadow.camera;
  s.left = s.bottom = -r; s.right = s.top = r; s.near = 0.1; s.far = r * 4;
  s.updateProjectionMatrix();

  let tris = 0;
  model.traverse((o) => { if (o.isMesh) tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; });
  info.innerHTML = `<b>${MODELS[name].label}</b>${ok ? '' : ' <span style="color:#ff8a6a">(placeholder: GLB failed to load)</span>'}<br>` +
    `Span ${size.x.toFixed(2)} m · height ${size.y.toFixed(2)} m · length ${size.z.toFixed(2)} m · ${Math.round(tris).toLocaleString()} triangles<br>` +
    `<span class="muted">Orange arrow = -Z (nose). Grid = 1 m. Click a node on the right to highlight it.</span>`;
  buildList(model);
  applyOpts();
}

function buildList(model) {
  list.innerHTML = '';
  const walk = (o, depth) => {
    const d = document.createElement('div');
    const p = o.getWorldPosition(new THREE.Vector3()).sub(model.position);
    d.innerHTML = `${'&nbsp;&nbsp;'.repeat(depth)}${o.isMesh ? '▪' : '○'} ${o.name || '(unnamed)'} <span class="muted">${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}</span>`;
    d.onclick = () => select(o, d);
    list.append(d);
    for (const c of o.children) walk(c, depth + 1);
  };
  for (const c of model.children) walk(c, 0);
}

function select(o, el) {
  for (const d of list.querySelectorAll('.sel')) d.classList.remove('sel');
  el.classList.add('sel');
  if (selBox) scene.remove(selBox);
  selBox = new THREE.BoxHelper(o, 0xffd84a);
  scene.add(selBox);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const timer = new THREE.Timer();
renderer.setAnimationLoop((t) => {
  timer.update(t);
  const dt = timer.getDelta();
  if (opts.spin) for (const s of spinners) s.rotation.z += dt * 25;
  controls.update();
  renderer.render(scene, camera);
});

show('b17');
