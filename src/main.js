// Game entry point: builds the scene, loads the planes and runs the loop.
import * as THREE from 'three';
import { Graphics } from './graphics.js';
import { World, ALTITUDE } from './world.js';
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
import { Tags } from './tags.js';

const ui = new UI();
const tags = new Tags(); // red / blue markers over the fighters, and the gunner's lead marker
const gfx = new Graphics();
const scene = new THREE.Scene();
const VIEW_FOV = 80, ZOOM_FOV = 28; // wide view to take in the battle; hold right click to zoom
const camera = new THREE.PerspectiveCamera(VIEW_FOV, innerWidth / innerHeight, 0.03, 200000);
let viewFov = VIEW_FOV;
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
const collide = (a, b, team, owner, cannon, src) => fighters.collide(a, b, team, owner, cannon, src);

// ten men in every bomber. You're the radio operator of yours; your crew are visible figures.
const crews = new Map(bombers.map((b) => [b, new Crew(b, b === bomber ? { visible: true, playerRole: 'radio', interior: bomber.interior } : {})]));
let crew = crews.get(bomber); // the crew you're part of (changes when you move to another bomber)
fighters.onBomberHit = (b, part, local, cannon) => crews.get(b).onHit(part, local, cannon, b === bomber ? player : null);
const flak = new Flak({ effects, audio, ui, bombers, playerBomber: bomber, onBomberHit: fighters.onBomberHit });
const mission = new Mission(scene, { effects, audio, ui, bombers, playerBomber: bomber });
mission.onEnd((d) => missionComplete(d));
bomber.onEvent((msg) => ui.toast(msg));
for (const c of crews.values()) c.onEvent((msg) => ui.toast(msg)); // only the visible crew speaks
const camPos = new THREE.Vector3(); // the camera in world space, refreshed during the frame
effects.camPos = camPos;
const pixelScale = () => effects.setPixelScale(gfx.renderer.getDrawingBufferSize(new THREE.Vector2()).y, camera.fov);
pixelScale();
addEventListener('resize', pixelScale);
gfx.onQualityChange(pixelScale);

// ---------- game state: menu -> playing <-> paused ----------
// The game starts on the click even if the browser refuses to capture the mouse;
// then you drag with the left button to look, and Esc still pauses.
let state = 'menu';
const canvas = gfx.renderer.domElement;

// Capture the mouse with raw input (no OS pointer acceleration, so the same hand movement always turns
// the view the same amount). Browsers without raw input get a plain capture.
function lock() {
  const plain = () => {
    try { canvas.requestPointerLock()?.catch?.(() => captureFailed()); } catch { captureFailed(); }
  };
  try {
    const p = canvas.requestPointerLock({ unadjustedMovement: true });
    if (p?.catch) p.catch((e) => (e?.name === 'NotSupportedError' ? plain() : captureFailed()));
  } catch { plain(); }
}

let failures = 0;
function captureFailed() {
  if (state !== 'playing') return;
  player.freeLook = true;
  document.body.classList.add('free-look');
  // Chrome refuses a new capture for about a second after Esc: a click a moment later works.
  // The Claude app's preview pane never allows it: there the game falls back to moving the cursor.
  document.getElementById('menu-browser')?.classList.add('warn'); // this window refused: say so on the menu too
  ui.hint(++failures < 3 ? 'Click to capture the mouse.'
    : 'Click to capture the mouse. If it never captures, open localhost:5173 in Chrome or Edge: this window doesn\'t allow it.');
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
    failures = 0;
    document.body.classList.remove('free-look');
    ui.hint('');
  } else if (state === 'playing') {
    pause(); // Esc while the mouse was captured
  }
});
document.addEventListener('pointerlockerror', captureFailed);
canvas.addEventListener('mousedown', () => { if (state === 'playing' && !document.pointerLockElement) lock(); }); // try again on every click
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && state === 'playing' && !document.pointerLockElement) pause();
});

// ---------- the player's life: first aid, being wounded, dying ----------
let aidT = 0, deathT = 0, seatTimer = 0;
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
    seatTimer = setTimeout(showSeatMap, 2500);
  }
}

/** "You were killed": the formation map, to carry on as any fit AI crewman on any surviving bomber. */
function showSeatMap() {
  if (state === 'over') return; // the mission ended in the meantime
  state = 'choosing';
  audio.fighterDrone(Infinity, 0); // the world stands still: no engine snarl
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
  mission.regroup();
  crew.becomePlayer(member);
  const st = STATIONS.find((s) => s.id === member.role.station);
  player.becomes(st ? st.stand : new THREE.Vector3(0, -1.8, -1.8), st ? st.yaw : Math.PI);
  player.deathShown = false;
  deathT = 0;
  if (st) { player.near = st; player.interact(); } // straight onto his gun (or into his seat)
  state = 'playing';
  player.enabled = true;
  audio.start(); // (also resumes sound suspended by a pause before you died)
  ui.play();
  lock();
  ui.toast(`You are now ${member.role.title.toLowerCase()} ${member.name}, ${bomber.label || 'lead squadron'}.`);
}

function missionComplete(d) {
  state = 'over';
  clearTimeout(seatTimer);
  audio.fighterDrone(Infinity, 0);
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
  }, () => location.reload(), (q) => gfx.setQuality(q));
}

function gameOver(title) {
  state = 'over';
  clearTimeout(seatTimer);
  audio.fighterDrone(Infinity, 0);
  player.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  ui.hurt(null);
  ui.menu({ title, text: `Fighters shot down: ${fighters.kills}.`, button: 'Fly again', onClick: () => location.reload(), quality: gfx.qualityName, onQuality: (q) => gfx.setQuality(q) });
}

/**
 * The packed formation puts a couple of hundred bombers within gun range of you: only the nearest
 * ones simulate their gunners (the rest are too far to matter), refreshed every second.
 */
const ACTIVE_GUNS = 60;
let activeT = 0;
function pickActiveGunners(dt) {
  if ((activeT -= dt) > 0) return;
  activeT = 1;
  const here = bomber.group.position;
  const live = bombers.filter((b) => !b.down && !b.gone);
  live.sort((a, b) => a.group.position.distanceToSquared(here) - b.group.position.distanceToSquared(here));
  live.forEach((b, i) => { b.gunsActive = i < ACTIVE_GUNS; });
}

/** Speed, height, heading and where the nose points, while you fly. */
const _nose = new THREE.Vector3();
function flightHud() {
  const c = player.controls;
  if (!c) return null;
  const f = bomber.flight;
  _nose.set(0, 0, -3000).applyMatrix4(bomber.group.matrixWorld).project(camera);
  return {
    mph: f.speed * 2.237, feet: (ALTITUDE + bomber.base.y) * 3.281, throttle: c.throttle,
    heading: ((-f.heading * 180) / Math.PI + 360) % 360, bank: (f.bank * 180) / Math.PI,
    offset: bomber.base.distanceTo(bomber.home),
    nose: _nose.z < 1 ? { x: (_nose.x + 1) / 2, y: (1 - _nose.y) / 2 } : null,
  };
}

// ---------- loop ----------
const timer = new THREE.Timer();
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
  const rawDt = timer.getDelta(), dt = Math.min(rawDt, 0.05);
  const live = state === 'playing';
  const running = live || state === 'menu'; // the world stands still while paused or picking a seat
  if (running) {
    t += dt;
    safely('world', () => { world.update(dt, AIRSPEED); world.follow(bomber.group.position); });
    safely('bombers', () => {
      const controls = live ? player.controls : null;
      bomber.manualFires = !!controls;
      for (const b of bombers) {
        if (live) b.fly(dt, b === bomber ? controls : null); // you at the controls, or the AI pilot holding (or regaining) the slot
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
        pickActiveGunners(dt);
        crew.setDisplaced(player.station?.id);
        camera.getWorldPosition(camPos);
        for (const [b, c] of crews) {
          c.update(dt, { player: b === bomber ? player : null, time: t });
          if (b !== bomber) c.fireUnseen(STATIONS, fighters, weapons.bullets, audio, camPos, dt);
        }
      });
      safely('life', () => lifeAndDeath(dt));
      if (player.bottlePressed != null) { bomber.pullBottle(player.bottlePressed); player.bottlePressed = null; }
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
    viewFov += ((player.zoom && live ? ZOOM_FOV : VIEW_FOV) - viewFov) * (1 - Math.exp(-dt * 12));
    if (Math.abs(viewFov - VIEW_FOV) < 0.05) viewFov = VIEW_FOV;
    player.lookScale = viewFov / VIEW_FOV;
    const s = mission.sightCamera(camera, player, viewFov);
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
      ui.health(bomber.health, bomber.bottles);
      ui.flight(flightHud());
      tags.update(camera, fighters.list, !!weapons.current(player) && !mission.atSight);
    });
  }
  ui.tick(rawDt);
  gfx.render();
});

// handy for testing from the browser console
Object.assign(window, { game: { THREE, scene, camera, player, bomber, bombers, get crew() { return crew; }, crews, gfx, world, weapons, fighters, effects, flak, mission, showSeatMap, takeSeat, audio, missionComplete, skip: (s) => { missionTime += s; } } });
