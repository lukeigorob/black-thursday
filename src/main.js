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
import { Pilot } from './pilot.js';
import { Stats, POINTS } from './stats.js';
import { Eject } from './eject.js';

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
// what you play: 'crew' (a B-17 crewman), 'bf109' or 'p51' (flying a fighter yourself)
let mode = 'crew';
const pilot = new Pilot(audio);
fighters.pilot = pilot;
const pilotStats = { bombers: 0, deaths: 0, killBase: null };
const stats = new Stats(); // your score, this life and the whole mission
const eject = new Eject(scene, effects.chuteMat); // hanging under a parachute after bailing out
let bailedOut = false;
// the fighters report your hits, crits, kills and assists
fighters.report = (kind, name, dmg) => {
  if (kind === 'hit') { stats.hit(dmg); return; }
  if (kind === 'kill') stats.kill(); else if (kind === 'assist') stats.assist(); else stats.crit();
  ui.banner(kind, name, POINTS[kind]);
  audio.chime(kind);
};

// ten men in every bomber. You're the radio operator of yours; your crew are visible figures.
const crews = new Map(bombers.map((b) => [b, new Crew(b, b === bomber ? { visible: true, playerRole: 'radio', interior: bomber.interior } : {})]));
let crew = crews.get(bomber); // the crew you're part of (changes when you move to another bomber)
// (you can only be hurt aboard while you're a crewman, not while you're off flying a fighter)
fighters.onBomberHit = (b, part, local, cannon) => crews.get(b).onHit(part, local, cannon, b === bomber && mode === 'crew' ? player : null);
const flak = new Flak({ effects, audio, ui, bombers, playerBomber: bomber, onBomberHit: fighters.onBomberHit });
const mission = new Mission(scene, { effects, audio, ui, bombers, playerBomber: bomber });
mission.onEnd((d) => missionComplete(d));
bomber.onEvent((msg) => { if (mode === 'crew') ui.toast(msg); }); // you only hear your crew aboard
for (const c of crews.values()) c.onEvent((msg) => { if (mode === 'crew') ui.toast(msg); }); // only the visible crew speaks
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
  player.freeLook = pilot.freeLook = eject.freeLook = true;
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
  player.enabled = mode === 'crew' && !eject.active && !player.away;
  pilot.active = mode !== 'crew' && pilot.alive && !eject.active;
  ui.setMode(eject.active ? 'eject' : mode);
  ui.play();
  lock();
}

function pause() {
  state = 'paused';
  player.enabled = false;
  player.keys = {};
  pilot.active = false; pilot.keys = {}; pilot.firing = false;
  audio.suspend();
  if (document.pointerLockElement) document.exitPointerLock();
  showMenu(true);
}

function showMenu(paused) {
  ui.menu({
    title: paused ? 'Paused' : 'B-17',
    text: paused ? '' : '25,000 feet over Germany, 1944. Fly with the bomber stream, or against it.',
    button: paused ? 'Resume' : null,
    onClick: play,
    roles: paused ? null : chooseRole,
    quality: gfx.qualityName,
    onQuality: (q) => gfx.setQuality(q),
  });
}

// ---------- roles: B-17 crewman, Bf 109 pilot, P-51 pilot ----------
/** The crewman you were leaves the game: an AI man takes his post (only if he's alive and well). */
function leaveCrew() {
  const me = crew.members.find((m) => m.state === 'player');
  if (me && !player.dead && !player.wounded) { me.state = 'ok'; me.task = 'station'; crew.place(me); }
  if (player.station) player.interact();
  player.enabled = false;
  player.away = true; // coming back means picking a seat again
  player.body.visible = false;
  crew.setDisplaced(null);
}

/** Your fighter (if it still flies) carries on with an AI pilot. */
function leaveFighter() {
  const f = pilot.f;
  pilot.stop();
  if (!f) return;
  f.obj.visible = true;
  if (!f.alive) return;
  f.player = false;
  if (f.side === 'allied') {
    const c = fighters.center, a = Math.atan2(f.pos.z - c.z, f.pos.x - c.x);
    f.station = { a, r: Math.max(600, Math.hypot(f.pos.x - c.x, f.pos.z - c.z)), h: f.pos.y - c.y, rate: 0.08 };
    f.state = 'patrol';
  } else { f.role = 'raider'; fighters.newAttack(f); }
}

let pilotDeathT = 0, roleBusy = false;
async function chooseRole(id) {
  if (roleBusy) return;
  if (id === 'crew') {
    leaveFighter();
    if (mode === 'crew' && !player.away && !player.dead) { if (!stats.lives) stats.newLife('crew'); play(); return; } // the start: you're the radio operator
    mode = 'crew';
    showSeatMap('Pick your bomber');
    return;
  }
  roleBusy = true;
  eject.stop(); ui.ejected(null); bailedOut = false;
  if (mode === 'crew') leaveCrew(); else leaveFighter();
  mode = id;
  fighters.crewView = false;
  fighters.playerSide = id === 'bf109' ? 'axis' : 'allied';
  pilotStats.killBase ??= fighters.kills;
  scene.attach(camera); // the camera leaves the bomber: it follows your fighter
  camera.up.set(0, 1, 0);
  ui.hurt(null); ui.sight(null); ui.aid(null);
  try {
    const f = await fighters.spawnPlayer(id);
    pilot.start(f, fighters);
    stats.newLife(id);
  } finally { roleBusy = false; }
  pilotDeathT = 0;
  play();
  ui.toast(id === 'bf109' ? 'Bf 109, JG 26. Break up the bomber stream!' : 'P-51, 357th Fighter Group. Keep the 109s off the bombers!');
}

/**
 * Shot down as a fighter pilot. If you're still alive (not hit yourself, not into the ground) you bail
 * out a moment later and hang under your chute; otherwise a few seconds watching the fall, then pick again.
 */
function fighterLife(dt) {
  if (pilot.alive || eject.active) { if (pilot.alive) pilotDeathT = 0; return; }
  const f = pilot.f;
  if (pilotDeathT === 0 && !bailedOut) { pilotStats.deaths++; ui.toast(f?.killedBy === 'ground' ? 'You flew into the ground.' : 'You\'ve been shot down!', 'kill'); pilot.firing = false; }
  pilotDeathT += dt;
  if (!bailedOut && f && !f.pilotDead && f.killedBy !== 'ground' && pilotDeathT > 1.2) { startEject(f.pos, f.velocity, 'fighter'); return; }
  if (pilotDeathT > 4 && state === 'playing') showRoleMenu('You were shot down');
}

/** J: bail out. From a fighter, or from your B-17 (a sensible idea when it's going down). */
function bailOut() {
  if (state !== 'playing' || eject.active) return;
  if (mode !== 'crew') {
    const f = pilot.f;
    if (!pilot.alive) return;
    pilot.stop();
    f.player = false;
    fighters.shotDown(f, 'bailout'); // the plane carries on without you, and goes down: a lost aircraft, nobody's kill
    f.bailT = undefined; // (you're the one under the chute)
    startEject(f.pos, f.velocity, 'fighter');
    return;
  }
  const me = crew.members.find((m) => m.state === 'player');
  if (!me || player.dead || player.wounded) return;
  if (player.station) player.interact();
  me.state = 'bailed'; me.task = 'down';
  crew.place(me);
  player.away = true;
  player.body.visible = false;
  camera.getWorldPosition(_ej);
  startEject(_ej.add(_up.set(0, -2.5, 0)), _up.set(0, -3, 0), 'crew'); // out of the waist door, into the slipstream
  ui.toast(bomber.down ? 'You got out!' : 'You bailed out of a flying bomber!');
}
addEventListener('keydown', (e) => { if (e.code === 'KeyJ' && !e.repeat) bailOut(); });

const _ej = new THREE.Vector3(), _up = new THREE.Vector3();
function startEject(pos, vel, from) {
  bailedOut = true;
  pilot.stop();
  player.enabled = false;
  scene.attach(camera);
  camera.up.set(0, 1, 0);
  ui.setMode('eject'); ui.sight(null); ui.hurt(null); ui.aid(null); ui.fighter(null);
  eject.start(_ej.copy(pos).add(_up.set(0, 2, 0)), vel, from, finishEject);
}

function finishEject() {
  const from = eject.from;
  eject.stop();
  ui.ejected(null);
  if (from === 'crew') showSeatMap('You bailed out'); else showRoleMenu('You bailed out');
}

function showRoleMenu(title) {
  state = 'choosing';
  pilot.active = false;
  audio.fighterDrone(Infinity, 0);
  if (document.pointerLockElement) document.exitPointerLock();
  ui.menu({ title, text: 'Fly again, or take another role.', roles: chooseRole, quality: gfx.qualityName, onQuality: (q) => gfx.setQuality(q) });
  document.getElementById('menu-text').innerHTML = `${ui.lifeCard(stats.life)}<br>Fly again, or take another role.`;
}

// a fighter pilot's bombers: a B-17 that goes down within 20 s of your rounds hitting it is yours
const downSeen = new Set();
function bomberKills() {
  for (const b of bombers) {
    if (!b.down || downSeen.has(b)) continue;
    downSeen.add(b);
    if (mode === 'bf109' && b.lastHitBy === 'player' && fighters.time - b.lastHitT < 20) {
      pilotStats.bombers++;
      stats.kill(true);
      ui.banner('kill', 'B-17 Flying Fortress', POINTS.bomber);
      audio.chime('kill');
    } else if (mode === 'bf109' && b.playerHitT > fighters.time - 20) { // you shot it up, someone else finished it
      stats.assist();
      ui.banner('assist', 'B-17', POINTS.assist);
      audio.chime('assist');
    }
  }
}
showMenu(false);

document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === canvas) {
    player.freeLook = pilot.freeLook = eject.freeLook = false;
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
function showSeatMap(title = null) {
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
    title: title ?? (bomber.down ? 'Your bomber went down' : 'You were killed'),
    text: 'Pick any surviving bomber on the map, then the crewman you will carry on as.',
    bombers, crewOf: (b) => crews.get(b), mine: bomber, onPick: takeSeat, onRole: chooseRole,
  });
  if (stats.lives) document.getElementById('map-text').innerHTML = `${ui.lifeCard(stats.life, 'That life')}<br>Pick any surviving bomber on the map, then the crewman you will carry on as.`;
}

function takeSeat(target, member) {
  // back into a B-17 (maybe from a fighter): the camera rides in the bomber again
  leaveFighter();
  mode = 'crew';
  fighters.crewView = true;
  fighters.playerSide = 'allied';
  bomber.group.add(camera);
  player.away = false;
  ui.setMode('crew');
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
  eject.stop(); ui.ejected(null); bailedOut = false;
  stats.newLife('crew');
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
  pilot.stop();
  eject.stop(); ui.ejected(null);
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
    pilot: { bombers: pilotStats.bombers, fighters: fighters.kills - (pilotStats.killBase ?? fighters.kills), deaths: pilotStats.deaths, saved: fighters.saved ?? 0 },
    score: stats.mission, lives: stats.lives,
  }, () => location.reload(), (q) => gfx.setQuality(q), mode);
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

const _sunLocal = new THREE.Vector3(), _bq = new THREE.Quaternion();

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
    safely('world', () => { world.update(dt, AIRSPEED); world.follow(eject.active ? eject.pos : mode === 'crew' || !pilot.f ? bomber.group.position : pilot.f.pos); });
    safely('bombers', () => {
      const controls = live && mode === 'crew' ? player.controls : null;
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
  if (mode === 'crew' && !eject.active) safely('player', () => player.update(live ? dt : 0));
  if (mode === 'crew' && !eject.active) safely('shafts', () => bomber.interior.updateShafts(_sunLocal.copy(world.sunDir).applyQuaternion(_bq.copy(bomber.group.quaternion).invert())));
  if (running) {
    if (live) {
      safely('crew', () => {
        pickActiveGunners(dt);
        crew.setDisplaced(mode === 'crew' && !eject.active ? player.station?.id : null);
        camera.getWorldPosition(camPos);
        for (const [b, c] of crews) {
          c.update(dt, { player: b === bomber && mode === 'crew' && !eject.active && !player.away ? player : null, time: t });
          if (b !== bomber) c.fireUnseen(STATIONS, fighters, weapons.bullets, audio, camPos, dt);
        }
      });
      safely('life', () => (mode !== 'crew' ? fighterLife(dt) : eject.active || player.away ? null : lifeAndDeath(dt)));
      stats.fired(weapons.bullets.playerFired); weapons.bullets.playerFired = 0;
      if (!eject.active && (mode === 'crew' ? !player.dead && !player.away : pilot.alive)) stats.tick(dt);
      bomberKills();
      if (player.bottlePressed != null) { bomber.pullBottle(player.bottlePressed); player.bottlePressed = null; }
    }
    safely('weapons', () => weapons.update(live ? dt : 0, player, camera, crew, fighters));
    if (live) safely('fighters', () => fighters.update(dt, player));
    if (mode !== 'crew' && !eject.active) safely('pilot', () => pilot.updateCamera(camera, live ? dt : 0));
    if (eject.active) safely('eject', () => eject.update(live ? dt : 0, camera));
    // your own engine while you fly (silent once you're shot down), the B-17's drone otherwise
    safely('engine', () => (mode !== 'crew' && pilot.alive ? audio.ownEngine(mode, pilot.throttle, pilot.f.speed) : audio.ownEngine(null)));
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
    const zoom = mode === 'crew' ? player.zoom : pilot.zoom;
    viewFov += ((zoom && live ? ZOOM_FOV : VIEW_FOV) - viewFov) * (1 - Math.exp(-dt * 12));
    if (Math.abs(viewFov - VIEW_FOV) < 0.05) viewFov = VIEW_FOV;
    player.lookScale = pilot.lookScale = eject.lookScale = viewFov / VIEW_FOV;
    const s = mission.sightCamera(camera, player, viewFov);
    if (camera.fov !== fov) pixelScale();
    if (live) ui.sight(s);
  });
  if (live) {
    safely('hud', () => {
      ui.mission(mission.status(missionTime));
      ui.lifeStats(stats.life);
      if (eject.active) { // under the parachute: the battle goes on above you
        ui.hud({ location: eject.t > 1.8 ? 'Under the parachute' : 'Bailing out', prompt: '', atStation: false });
        ui.ejected(ui.lifeCard(stats.life, eject.from === 'crew' ? 'That life' : 'This sortie'), eject.ready);
        tags.update(camera, fighters.list, { side: fighters.playerSide });
        return;
      }
      if (mode !== 'crew') { // flying a fighter
        ui.hud({ location: pilot.f ? `${pilot.f.k.name} · ${pilot.view === 'nose' ? 'nose view' : 'chase view'}` : '', prompt: '', atStation: true });
        if (pilot.f) ui.fighter(pilot.status(camera));
        tags.update(camera, fighters.list, { side: fighters.playerSide, lead: pilot.alive, self: pilot.f, bombers });
        return;
      }
      ui.hud({ location: player.location, prompt: player.prompt, atStation: !!player.station });
      ui.gun(weapons.status(player));
      ui.crew(crew.members);
      ui.engines(bomber);
      ui.health(bomber.health, bomber.bottles);
      ui.flight(flightHud());
      tags.update(camera, fighters.list, { side: 'allied', lead: !!weapons.current(player) && !mission.atSight });
    });
  }
  ui.tick(rawDt);
  gfx.render();
});

// handy for testing from the browser console
Object.assign(window, { game: { THREE, scene, camera, player, bomber, bombers, get crew() { return crew; }, crews, gfx, world, weapons, fighters, effects, flak, mission, showSeatMap, takeSeat, audio, missionComplete, pilot, chooseRole, pilotStats, stats, eject, bailOut, get mode() { return mode; }, skip: (s) => { missionTime += s; } } });
