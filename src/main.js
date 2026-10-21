// Game entry point: builds the scene, loads the planes and runs the loop.
import * as THREE from 'three';
import { Graphics } from './graphics.js';
import { World } from './world.js';
import { loadModel } from './models.js';
import { Bomber, AIRSPEED, swapBombers } from './bomber.js';
import { Player } from './player.js';
import { GameAudio } from './audio.js';
import { Weapons } from './weapons.js';
import { Effects } from './effects.js';
import { Fighters } from './fighters.js';
import { UI } from './ui.js';
import { formationSlots, Fleet, Contrails, Detail } from './formation.js';
import { Crew, WOUND_TIME, REVIVE_TIME } from './crew.js';
import { STATIONS } from './interior.js';
import { Flak } from './flak.js';
import { Mission } from './mission.js';
import { tally } from './crew.js';

const ui = new UI();
const gfx = new Graphics();
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.03, 200000);
const world = new World(gfx.renderer, scene);
gfx.setup(scene, camera);
gfx.onQualityChange((q) => world.setQuality(q));
world.setQuality(gfx.quality);
const audio = new GameAudio();

ui.menu({ title: 'B-17', text: 'Loading the aircraft…', quality: gfx.qualityName, onQuality: (q) => gfx.setQuality(q) });

// the bomber stream (the player's bomber starts at the origin, the scenery moves instead).
// The player's bomber gets the full model, its nearest neighbours a mid-detail one (handed out
// by Detail, wherever the player is), and everything further away is drawn as instanced copies.
const slots = formationSlots();
const neighbours = slots.filter((s) => s.near && !s.player).length;
const [own, lod, ...mids] = await Promise.all([loadModel('b17'), loadModel('b17', { lod: true }),
  ...Array.from({ length: neighbours }, () => loadModel('b17', { mid: true }))]);
const bombers = slots.map((s) => new Bomber(s.player ? own.scene : null, { position: s.pos, interior: s.player, label: s.label, squad: s.group, lead: s.lead }));
const bomber = bombers[slots.findIndex((s) => s.player)]; // the player's: always this object (see swapBombers)
own.scene.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
for (const m of mids) m.scene.traverse((o) => { if (o.isMesh) o.receiveShadow = true; });
scene.add(bomber.group);
const fleet = new Fleet(scene, lod.scene, bombers);
const detail = new Detail(scene, bombers, bomber, mids.map((m) => m.scene));
detail.assign();
const contrails = new Contrails(scene, bombers);
const player = new Player(bomber, camera);
const weapons = new Weapons(scene, audio);
weapons.attach(bomber);
const effects = new Effects(scene);
const fighters = new Fighters(scene, { effects, bullets: weapons.bullets, audio, ui, bombers, playerBomber: bomber });
const collide = (a, b, team, owner, cannon) => fighters.collide(a, b, team, owner, cannon);

// ten men in every bomber. You're the radio operator of yours; your crew are visible figures.
const crews = new Map(bombers.map((b) => [b, new Crew(b, b === bomber ? { visible: true, playerRole: 'radio', interior: bomber.interior } : {})]));
let crew = crews.get(bomber); // the crew you're part of (changes when you move to another bomber)
fighters.onBomberHit = (b, part, local, cannon) => crews.get(b).onHit(part, local, cannon, b === bomber ? player : null);
const flak = new Flak({ effects, audio, ui, bombers, playerBomber: bomber, onBomberHit: fighters.onBomberHit });
const mission = new Mission(scene, { effects, audio, ui, bombers, playerBomber: bomber });
mission.onEnd((d) => missionComplete(d));
bomber.onEvent((msg) => ui.toast(msg));
for (const c of crews.values()) c.onEvent((msg) => ui.toast(msg)); // only the visible crew speaks
const pixelScale = () => effects.setPixelScale(gfx.renderer.getDrawingBufferSize(new THREE.Vector2()).y, camera.fov);
pixelScale();
addEventListener('resize', pixelScale);
gfx.onQualityChange(pixelScale);

// ---------- game state: menu -> playing <-> paused ----------
// The game starts on the click even if the browser refuses to capture the mouse;
// then you drag with the left button to look, and Esc still pauses.
let state = 'menu';
const canvas = gfx.renderer.domElement;

function lock() {
  try {
    const p = canvas.requestPointerLock();
    p?.catch?.(() => captureFailed());
  } catch { captureFailed(); }
}

let hintTimer = 0;
function captureFailed() {
  if (state !== 'playing' || player.freeLook) return;
  player.freeLook = true;
  document.body.classList.add('free-look');
  ui.hint('This browser won\'t capture the mouse: move the mouse to look, and hold it near a screen edge to keep turning. Open localhost:5173 in Chrome for full mouse look.');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => ui.hint(''), 7000);
}

function play() {
  audio.start();
  state = 'playing';
  player.enabled = true;
  ui.play();
  lock();
}

function pause() {
  state = 'paused';
  player.enabled = false;
  player.keys = {};
  audio.suspend();
  if (document.pointerLockElement) document.exitPointerLock();
  showMenu(true);
}

function showMenu(paused) {
  ui.menu({
    title: paused ? 'Paused' : 'B-17',
    text: paused ? '' : 'You are a crew member aboard a B-17 Flying Fortress at 25,000 feet.',
    button: paused ? 'Resume' : 'Start',
    onClick: play,
    quality: gfx.qualityName,
    onQuality: (q) => gfx.setQuality(q),
  });
}
showMenu(false);

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    player.freeLook = false;
    document.body.classList.remove('free-look');
    ui.hint('');
  } else if (state === 'playing') {
    pause(); // Esc while the mouse was captured
  }
});
document.addEventListener('pointerlockerror', captureFailed);
canvas.addEventListener('mousedown', () => { if (state === 'playing' && !document.pointerLockElement && !player.freeLook) lock(); });
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && state === 'playing' && !document.pointerLockElement) pause();
});

// ---------- the player's life: first aid, being wounded, dying ----------
let aidT = 0, deathT = 0;
function lifeAndDeath(dt) {
  // hold F next to a wounded man to patch him up
  player.firstAid = '';
  let patient = null;
  if (!player.wounded && !player.dead && !player.station) {
    patient = crew.members.find((m) => m.state === 'wounded' && m.pos && Math.hypot(m.pos.x - player.feet.x, m.pos.z - player.feet.z) < 1.3);
  }
  if (patient) {
    aidT = player.keys.KeyF ? aidT + dt : 0;
    player.firstAid = `<b>F</b> Hold to patch up ${patient.role.title.toLowerCase()} ${patient.name}`;
    if (aidT >= REVIVE_TIME) { crew.revive({ member: patient }, true); aidT = 0; }
  } else aidT = 0;
  ui.aid(patient && aidT > 0 ? aidT / REVIVE_TIME : null);

  ui.hurt(player.wounded ? player.woundLeft : null, WOUND_TIME, crew.members.some((m) => m.task === 'helping' && m.patient?.player));
  audio.heartbeat(player.wounded ? 1 - player.woundLeft / WOUND_TIME : 0, dt);

  // bomber going down, or you bled out: pick another man on any surviving bomber
  if (bomber.down && !player.dead && (deathT += dt) > 8) player.dead = true;
  if (player.dead && !player.deathShown) {
    player.deathShown = true;
    ui.toast(bomber.down ? 'Your bomber is going down.' : 'You were killed.', 'kill');
    setTimeout(showSeatMap, 2500);
  }
}

/** "You were killed": the formation map, to carry on as any fit AI crewman on any surviving bomber. */
function showSeatMap() {
  state = 'choosing';
  player.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  ui.hurt(null);
  const me = crew.members.find((m) => m.state === 'player');
  if (me) { // the man you were stays where he fell
    me.state = 'dead';
    me.spot = { ...me.spot, lie: player.feet.toArray(), liePose: 'lie' };
    crew.place(me);
  }
  const anyone = bombers.some((b) => !b.down && !b.gone && crews.get(b).members.some((m) => m.state === 'ok'));
  if (!anyone) { gameOver('The bombers are all gone'); return; }
  ui.map({
    title: bomber.down ? 'Your bomber went down' : 'You were killed',
    text: 'Pick any surviving bomber on the map, then the crewman you will carry on as.',
    bombers, crewOf: (b) => crews.get(b), mine: bomber, onPick: takeSeat,
  });
}

function takeSeat(target, member) {
  if (target !== bomber) {
    // your full-detail bomber (interior, guns, visible crew) moves into the chosen bomber's place
    const mine = crews.get(bomber), theirs = crews.get(target);
    swapBombers(bomber, target);
    crews.set(bomber, theirs); crews.set(target, mine);
    theirs.bomber = bomber; mine.bomber = target;
    mine.handFiguresTo(theirs);
    crew = theirs;
    weapons.rearm();
    detail.assign();
    fighters.near = null;
    bomber.interior.emptyBombBay(bomber.bombs < 12); // this bomber may have dropped already
  }
  crew.becomePlayer(member);
  const st = STATIONS.find((s) => s.id === member.role.station);
  player.becomes(st ? st.stand : new THREE.Vector3(0, -1.8, -1.8), st ? st.yaw : Math.PI);
  player.deathShown = false;
  deathT = 0;
  if (st) { player.near = st; player.interact(); } // straight onto his gun (or into his seat)
  state = 'playing';
  player.enabled = true;
  ui.play();
  lock();
  ui.toast(`You are now ${member.role.title.toLowerCase()} ${member.name}, ${bomber.label || 'lead squadron'}.`);
}

function missionComplete(d) {
  state = 'over';
  player.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  ui.hurt(null);
  ui.sight(null);
  ui.debrief({
    ...d,
    kills: fighters.tally ?? { player: 0, crew: 0, escorts: 0, alliedLost: 0 },
    bombersLost: bombers.filter((b) => b.down).length, bombers: bombers.length,
    saved: tally.saved, savedByYou: tally.savedByYou,
    crewHome: crew.members.filter((m) => m.state === 'ok' || m.state === 'wounded' || m.state === 'player').length,
  }, () => location.reload());
}

function gameOver(title) {
  state = 'over';
  player.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  ui.hurt(null);
  ui.menu({ title, text: `Fighters shot down: ${fighters.kills}.`, button: 'Fly again', onClick: () => location.reload(), quality: gfx.qualityName, onQuality: (q) => gfx.setQuality(q) });
}

// ---------- loop ----------
const timer = new THREE.Timer();
const camPos = new THREE.Vector3();
let t = 0, missionTime = 0;
const failed = new Set();
/** Run one part of the frame; if it throws, log it once and carry on, so the game never freezes. */
function safely(name, fn) {
  try { fn(); } catch (err) {
    if (!failed.has(name)) { failed.add(name); console.error(`[${name}] failed this frame:`, err); }
  }
}
gfx.renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.05);
  const live = state === 'playing';
  const running = live || state === 'menu'; // the world stands still while paused or picking a seat
  if (running) {
    t += dt;
    safely('world', () => { world.update(dt, AIRSPEED); world.follow(bomber.group.position); });
    safely('bombers', () => {
      for (const b of bombers) {
        b.update(t, dt);
        if (live) b.updateDamage(dt, effects);
      }
      detail.update(dt);
      fleet.update();
      contrails.update();
    });
  }
  safely('player', () => player.update(live ? dt : 0));
  if (running) {
    if (live) {
      safely('crew', () => {
        crew.setDisplaced(player.station?.id);
        camera.getWorldPosition(camPos);
        for (const [b, c] of crews) {
          c.update(dt, { player: b === bomber ? player : null, time: t });
          if (b !== bomber) c.fireUnseen(STATIONS, fighters, weapons.bullets, audio, camPos, dt);
        }
      });
      safely('life', () => lifeAndDeath(dt));
    }
    safely('weapons', () => weapons.update(live ? dt : 0, player, camera, crew, fighters));
    if (live) safely('fighters', () => fighters.update(dt, player));
    if (live) {
      missionTime += dt;
      safely('mission', () => mission.update(dt, { player, time: missionTime, flak, fighters }));
      safely('flak', () => flak.update(dt));
    }
    safely('bullets', () => weapons.bullets.update(dt, camera.getWorldPosition(camPos), collide));
    safely('effects', () => effects.update(dt));
  }
  safely('sight', () => { // the Norden sight takes over the camera while you're at it
    const fov = camera.fov;
    const s = mission.sightCamera(camera, player);
    if (camera.fov !== fov) pixelScale();
    if (live) ui.sight(s);
  });
  if (live) {
    safely('hud', () => {
      ui.mission(mission.status(missionTime));
      ui.hud({ location: player.location, prompt: player.prompt, atStation: !!player.station });
      ui.gun(weapons.status(player));
      ui.crew(crew.members);
      ui.engines(bomber);
    });
  }
  ui.tick(dt);
  gfx.render();
});

// handy for testing from the browser console
Object.assign(window, { game: { THREE, scene, camera, player, bomber, bombers, get crew() { return crew; }, crews, gfx, world, weapons, fighters, effects, flak, mission, showSeatMap, takeSeat, audio, missionComplete, skip: (s) => { missionTime += s; } } });
