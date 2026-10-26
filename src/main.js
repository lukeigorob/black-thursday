// Game entry point: builds the scene, loads the planes and runs the loop.
import * as THREE from 'three';
import { Graphics } from './graphics.js';
import { World, ALTITUDE } from './world.js';
import { loadModel } from './models.js';
import { Bomber, AIRSPEED, swapBombers, PART } from './bomber.js';
import { Player } from './player.js';
import { GameAudio } from './audio.js';
import { Weapons } from './weapons.js';
import { Effects } from './effects.js';
import { Fighters, AXIS_TOTAL, ALLIED_TOTAL } from './fighters.js';
import { UI } from './ui.js';
import { formationSlots, Fleet, Contrails, Detail } from './formation.js';
import { Crew, WOUND_TIME, REVIVE_TIME } from './crew.js';
import { STATIONS } from './interior.js';
import { Flak } from './flak.js';
import { Mission } from './mission.js';
import { tally } from './crew.js';
import { Tags } from './tags.js';
import { Pilot } from './pilot.js';
import { walkSweep } from './walksweep.js';
import { loadCrewModel, syncFigures, crewInfo } from './figure.js';
import { Stats, POINTS } from './stats.js';
import { Eject } from './eject.js';
import { Dust } from './dust.js';
import { Breakup } from './breakup.js';
import { DETAIL } from './cabinlook.js';
import { SCARS, bakeBomberSpace, scarMaterial, addScar, clearScars } from './scars.js';
import { loadEnv, saveEnv, WET, WEATHER, loadEnvMode, saveEnvMode, rollEnv, DEFAULT_ENV, envLabel } from './environment.js';

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


// the bomber stream (the player's bomber starts at the origin, the scenery moves instead).
// The player's bomber gets the full model, its nearest neighbours a mid-detail one (handed out
// by Detail, wherever the player is), and everything further away is drawn as instanced copies.
const slots = formationSlots();
const neighbours = slots.filter((s) => s.near && !s.player).length;
// the loading screen follows the pieces as they come in: your bomber and the far ones, the near ones and the
// break-up copies, the crewmen, then the formation built
const FUEL = 0, ARM = 1, CREW = 2, FORM = 3;
const loading = ui.loading(['Fuelling', 'Arming', 'Crew aboard', 'Forming up'], neighbours + 5, gfx.qualityName, (q) => gfx.setQuality(q));
const [own, lod, ...mids] = await Promise.all([loading.track(loadModel('b17'), FUEL), loading.track(loadModel('b17', { lod: true }), FUEL), loading.track(loadCrewModel(), CREW),
  ...Array.from({ length: neighbours }, () => loading.track(loadModel('b17', { mid: true }), ARM))]).then(([a, b, , ...rest]) => [a, b, ...rest]); // (the crewmen load alongside)
bakeBomberSpace(own.scene); // (for the battle damage and exhaust stains drawn on her skin, scars.js)
const bombers = slots.map((s) => new Bomber(s.player ? own.scene : null, { position: s.pos, interior: s.player, label: s.label, squad: s.group, lead: s.lead }));
const bomber = bombers[slots.findIndex((s) => s.player)]; // the player's: always this object (see swapBombers)
own.scene.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
own.scene.traverse((o) => { if (o.isMesh && o.geometry.attributes.aBP && !o.name.endsWith('_lining')) scarMaterial(o.material); });
// the extra surface detail (scars, exhaust, worn edges, grime) follows the quality setting
const setDetail = (q) => { SCARS.detail.value = DETAIL.value = q.detail ? 1 : 0; };
gfx.onQualityChange(setDetail);
setDetail(gfx.quality);
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
weapons.effects = effects; // (the guns' muzzle smoke)
ui.sound((v, muted) => audio.setVolume(v, muted)); // (the menu's mute button and volume line)
// bombers coming apart: their lost wings and tails fall away on their own (breakup.js), copied from
// clean models (the pooled ones may be cut at the time)
const breakup = new Breakup(scene, effects, { lod: lod.scene, mid: (await loading.track(loadModel('b17', { mid: true }), ARM)).scene });
detail.onFree = (b) => breakup.release(b); // (a model going back to the pool goes back uncut: the next bomber to get it is whole)
breakup.warm(gfx.renderer, camera);
for (const b of bombers) b.onBreak = (kind, side, z, vel) => {
  breakup.lose(b, kind, side, z, vel);
  if (b === bomber && mode === 'crew' && !player.away && !player.dead) { player.kick(4); audio.explosion(5); } // (you feel it go)
};
const fighters = new Fighters(scene, { effects, bullets: weapons.bullets, audio, ui, bombers, playerBomber: bomber });
const collide = (a, b, team, owner, cannon, src) => fighters.collide(a, b, team, owner, cannon, src);
// what you play: 'crew' (a B-17 crewman), 'bf109', 'fw190' or 'p51' (flying a fighter yourself)
const AXIS_ROLES = new Set(['bf109', 'fw190']);
let mode = 'crew';
const pilot = new Pilot(audio);
fighters.pilot = pilot;
ui.hudOptions((o) => { Object.assign(tags.opts, o); pilot.plainSight = o.plainSight; }); // (which markers are drawn, which fighter sight: the Options tab)
// the time of day, season and weather: the world, the contrails and the cabin lights follow it
// this mission's conditions: the default (summer, day, clear), the ones chosen, or rolled at random for every mission
let envMode = loadEnvMode();
const chosen = loadEnv(); // (what Choose is set to, remembered)
const env = { ...(envMode === 'random' ? rollEnv() : envMode === 'choose' ? chosen : DEFAULT_ENV) };
let flakEnv = () => {}; // (set once the flak exists, below)
function applyEnv(_, from) {
  if (from === 'settings' && envMode !== 'choose') { envMode = 'choose'; saveEnvMode(envMode); ui.showConditions?.('choose'); } // (changed by hand: it's chosen now)
  if (envMode === 'choose') { Object.assign(chosen, env); saveEnv(chosen); }
  gfx.renderer.toneMappingExposure = world.setEnv(env);
  contrails.setEnv(env);
  bomber.interior?.setNight(env.time === 'night' ? 1 : env.time === 'twilight' ? 0.5 : 0);
  pilot.night = env.time === 'night' ? 1 : env.time === 'twilight' ? 0.45 : 0; // the fighter's instrument glow
  SCARS.light.value = (env.time === 'night' ? 0.03 : env.time === 'twilight' ? 0.35 : 1) * (1 - 0.5 * (WEATHER[env.weather]?.overcast ?? 0)); // (daylight through the holes in her skin)
  flakEnv(); // (the flak's flashes: lighting the bombers by night, muffled in cloud)
  const strip = document.querySelector('#menu-facts [data-fact="cond"] b');
  if (strip) strip.textContent = envLabel(env);
}
applyEnv();
ui.envControls(env, applyEnv);
ui.conditions(envMode, env, (m) => {
  envMode = m; saveEnvMode(m);
  Object.assign(env, m === 'random' ? rollEnv() : m === 'choose' ? chosen : DEFAULT_ENV);
  applyEnv(env);
}, (k, v) => { env[k] = v; applyEnv(env); });
const pilotStats = { bombers: 0, deaths: 0, killBase: null };
const stats = new Stats(); // your score, this life and the whole mission
const eject = new Eject(scene); // hanging under a parachute after bailing out
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
fighters.onBomberHit = (b, part, local, cannon, dir) => {
  if (b === bomber && dir) addScar(b, local, dir, cannon); // a hole in her skin where it went in
  crews.get(b).onHit(part, local, cannon, b === bomber && mode === 'crew' ? player : null);
};
const flak = new Flak({ effects, audio, ui, bombers, playerBomber: bomber, onBomberHit: fighters.onBomberHit,
  onClose: (k) => { if (mode === 'crew' && !player.away && !eject.active) { player.jolt(k); audio.flakClose(k); } } }); // (felt inside your bomber)
player.onSightRefused = () => ui.log(mission.phase === 'outbound' ? `Bombsight: nothing to aim at yet. ${mission.status(missionTime).replace(/^Outbound · /, '')}.` : 'Bombsight: the bombs are away.');
flakEnv = () => { flak.night = env.time === 'night' ? 1 : env.time === 'twilight' ? 0.45 : 0; flak.muffle = WEATHER[env.weather]?.overcast ?? 0; };
flakEnv();
const mission = new Mission(scene, { effects, audio, ui, bombers, playerBomber: bomber });
mission.onEnd((d) => missionComplete(d));
bomber.onEvent((msg) => { if (mode === 'crew') ui.log(msg); }); // you only hear your crew aboard
for (const c of crews.values()) c.onEvent((msg) => { if (mode === 'crew') ui.log(msg); }); // only the visible crew speaks
// the men's cries: yours, or a man near you in your own bomber (quieter further down the fuselage)
for (const c of crews.values()) c.onSound = (kind, m) => {
  if (c !== crew || mode !== 'crew') return;
  if (!m) { audio.pain(1, kind === 'down', 0.4); return; }
  const at = m.task === 'station' ? m.spot.at : m.pos?.toArray() ?? m.spot.at;
  const d = Math.hypot(at[0] - player.feet.x, at[2] - player.feet.z);
  audio.pain(Math.max(0, 1 - d / 14), kind === 'down', (m.role.id.length % 5) / 5);
};
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
  const quality = gfx.qualityName, onQuality = (q) => gfx.setQuality(q);
  if (!paused) {
    ui.menu({
      kind: 'start', kicker: 'Eighth Air Force · 1944', title: 'B-17', sub: 'Flying Fortress', stamp: 'Restricted',
      text: 'Mission briefing: 25,000 feet over Germany, in daylight. The stream bombs the aircraft works and turns for home. Fly with it, or against it.',
      facts: [['Target', 'Aircraft works'], ['Altitude', '25,000 ft'], ['Force', `${bombers.length} B-17s`], ['Escort', `${ALLIED_TOTAL} P-51s`], ['Opposition', `${AXIS_TOTAL} fighters`], ['Conditions', envLabel(env)]],
      roles: chooseRole, quality, onQuality,
      hint: '<kbd>1</kbd>–<kbd>4</kbd> pick a role · <kbd>←</kbd> <kbd>→</kbd> move · <kbd>Enter</kbd> take it',
    });
    return;
  }
  const d = mission.mapData(missionTime);
  ui.menu({
    kind: 'pause', kicker: 'Crew, stand by', title: 'Paused', stamp: 'Hold',
    status: {
      phase: d.phase, detail: mission.status(missionTime), toTarget: d.toTarget, role: mode,
      health: mode === 'crew' ? (player.away ? null : bomber.health) : pilot.alive ? pilot.status(camera).health : null,
      engines: 4 - bomber.deadEngines, crewFit: crew.members.filter((m) => m.state === 'ok' || m.state === 'player').length,
      life: stats.life, mission: stats.mission, lives: stats.lives, forces: bomberCounts(),
    },
    button: 'Resume', onClick: play, quality, onQuality,
    seats: mode === 'crew' && !player.away && !player.dead && !player.wounded ? seatList() : null,
    onSeat: (id) => { moveToSeat(id); play(); },
    actions: [{ label: 'Change aircraft', onClick: () => showRoleMenu('Change aircraft', true) }, { label: 'Controls', onClick: () => ui.drawer('controls') }, { label: 'Options', onClick: () => ui.drawer('options') }, { label: 'Settings', onClick: () => ui.drawer('settings') },
      { label: 'Quit to menu', confirm: 'Click again to quit', onClick: () => location.reload() }],
    hint: 'Quitting starts the mission again from the briefing',
  });
}

// ---------- the pause menu's crew positions: move to any of them on your bomber ----------
const SEATS = [['pilot', 'Pilot'], ['copilot', 'Co-pilot'], ['noseL', 'Nose gun, left'], ['noseR', 'Nose gun, right'], ['bombsight', 'Bombsight'], ['cheekL', 'Left cheek gun'], ['cheekR', 'Right cheek gun'],
  ['top', 'Top turret'], ['radio', 'Radio room gun'], ['ball', 'Ball turret'], ['waistL', 'Left waist'], ['waistR', 'Right waist'], ['tail', 'Tail gun']];
function seatList() {
  return SEATS.map(([id, name]) => {
    const st = id === 'bombsight' ? 'noseR' : id;
    const m = crew.members.find((x) => x.role.station === st);
    const here = player.station?.id === id;
    const out = !bomber.turretWorks(id);
    const state = here ? 'you' : out ? 'out' : !m ? 'free' : m.state === 'player' ? 'free' : m.state === 'ok' ? 'ok' : m.state;
    const who = m ? (m.state === 'player' ? 'your post' : `${m.role.title} ${m.name}`) : 'no one';
    return { id, name, who, state, here, can: !out && m?.state !== 'dead' };
  });
}
function moveToSeat(id) {
  const st = STATIONS.find((s) => s.id === id);
  player.becomes(st.stand, st.yaw);
  player.near = st; player.passage = null; player.interact(); // (straight onto it: his man steps aside, as when you walk up to it)
}

// ---------- roles: B-17 crewman, Bf 109 pilot, P-51 pilot ----------
/** The crewman you were leaves the game: an AI man takes his post (only if he's alive and well). */
function leaveCrew() {
  const me = crew.members.find((m) => m.state === 'player');
  if (me && !player.dead && !player.wounded) { me.state = 'ok'; me.standIn = false; me.task = 'station'; crew.place(me); }
  if (player.station) player.interact();
  player.detachAll();
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
  roleBack = false;
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
  fighters.playerSide = AXIS_ROLES.has(id) ? 'axis' : 'allied';
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
  ui.log(id === 'bf109' ? 'Bf 109, JG 26. Break up the bomber stream!' : id === 'fw190' ? 'Fw 190, IV.(Sturm)/JG 3. Go through the bombers head-on!' : 'P-51, 357th Fighter Group. Keep the 109s off the bombers!');
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
  player.detachAll(); // (the iron sight and turret cockpits off the camera before it leaves the plane)
  me.state = 'bailed'; me.task = 'down';
  crew.place(me);
  player.away = true;
  player.body.visible = false;
  camera.getWorldPosition(_ej);
  startEject(_ej.add(_up.set(0, -2.5, 0)), _up.set(0, -3, 0), 'crew'); // out of the waist door, into the slipstream
  ui.log(bomber.down ? 'You got out!' : 'You bailed out of a flying bomber!');
}
addEventListener('keydown', (e) => { if (e.code === 'KeyJ' && !e.repeat) bailOut(); });
addEventListener('keydown', (e) => { if (e.code === 'KeyH' && !e.repeat && state === 'playing') ui.toggleControls(); });

/** The keys that do something where you are (the controls card): [rows, a key for where that is]. */
function controlsFor(p) {
  const s = p.station;
  if (p.wounded || p.dead) return [[], 'none'];
  if (!s) return [[['W A S D', 'walk'], ['Shift', 'hurry'], ['E', 'take a station'], ['F', 'first aid (hold, by a wounded man)'], ['M', 'formation map'], ['J', 'bail out']], 'walk'];
  if (s.flies) return [[['Mouse', 'steer'], ['W / S', 'throttle'], ['A / D', 'roll'], ['T', 'fire bottle, worst engine'], ['F', 'feather it'], ['1 / 2 / 3 / 4', 'a bottle on that engine'], ['C', 'hold: look round'], ['E', 'leave the seat']], `seat:${s.id}`];
  if (s.sight) return [[['A / D', 'steer the formation'], ['Space / Click', 'bombs away'], ['C', 'hold: look round'], ['E', 'leave the sight']], 'sight'];
  return [[['Click', 'fire'], ['Right click', 'zoom'], ['R', 'reload'], ['C', 'hold: look round'], ['E', 'leave the gun']], `gun:${s.id}`];
}

// ---------- the mission map: hold M ----------
let mapHeld = false, mapT = 0;
addEventListener('keydown', (e) => { if (e.code === 'KeyM' && state === 'playing') mapHeld = true; });
addEventListener('keyup', (e) => { if (e.code === 'KeyM') mapHeld = false; });
addEventListener('blur', () => { mapHeld = false; });
function missionMapData() {
  const d = mission.mapData(missionTime);
  const me = eject.active ? eject.pos : mode === 'crew' ? bomber.group.position : pilot.f?.pos;
  const near = me ?? bomber.group.position;
  d.self = me ? d.rel(me) : null;
  d.bombers = bombers.filter((b) => !b.down).map((b) => d.rel(b.group.position));
  d.fighters = fighters.list.filter((f) => f.alive && !f.player && f.pos.distanceTo(near) < 5000).map((f) => ({ side: f.side, at: d.rel(f.pos) }));
  return d;
}

const _ej = new THREE.Vector3(), _up = new THREE.Vector3();
function startEject(pos, vel, from) {
  bailedOut = true;
  pilot.stop();
  player.detachAll();
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

function showRoleMenu(title, change = false) {
  state = 'choosing';
  pilot.active = false;
  audio.fighterDrone(Infinity, 0);
  if (document.pointerLockElement) document.exitPointerLock();
  ui.menu({ kind: 'roles', kicker: change ? 'Paused' : 'Sortie over', title, text: change ? 'Take another aircraft, or go back to the bomber crew.' : 'Fly again, or take another role.', body: change ? '' : ui.lifeCard(stats.life), roles: chooseRole,
    quality: gfx.qualityName, onQuality: (q) => gfx.setQuality(q), hint: `<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> pick a role${change ? ' · <kbd>Esc</kbd> back' : ''}`,
    actions: change ? [{ label: 'Back', onClick: backToPause }] : [] });
  roleBack = change;
}
let roleBack = false; // (the role picker opened from the pause menu: Esc goes back to it)
function backToPause() { roleBack = false; state = 'paused'; showMenu(true); }

// a fighter pilot's bombers: a B-17 that goes down within 20 s of your rounds hitting it is yours
const downSeen = new Set();
function bomberKills() {
  for (const b of bombers) {
    if (!b.down || downSeen.has(b)) continue;
    downSeen.add(b);
    if (AXIS_ROLES.has(mode) && b.lastHitBy === 'player' && fighters.time - b.lastHitT < 20) {
      pilotStats.bombers++;
      stats.kill(true);
      ui.banner('kill', 'B-17 Flying Fortress', POINTS.bomber);
      audio.chime('kill');
    } else if (AXIS_ROLES.has(mode) && b.playerHitT > fighters.time - 20) { // you shot it up, someone else finished it
      stats.assist();
      ui.banner('assist', 'B-17', POINTS.assist);
      audio.chime('assist');
    }
  }
}
await warmUp();
loading.tick(FORM);
showMenu(false);

/**
 * Compile now, behind the loading screen, every shader the game can need later. A shader seen for the
 * first time is compiled there and then, and on Windows that stalls the game for one to three seconds
 * (the first fighter close by, a bomber breaking up, the first flight in a cockpit). So: the fighters'
 * full models and their cockpits and sights, everything that starts hidden (rain, parachutes, effects),
 * the cut-up versions of your own bomber, and the night sky, each compiled once with the scene's lights.
 */
async function warmUp() {
  const r = gfx.renderer, extra = new THREE.Group();
  const shown = [];
  scene.traverse((o) => { if (!o.visible) { shown.push(o); o.visible = true; } }); // (hidden for now: the rain, chutes, flashes...)
  for (const kind of ['bf109', 'fw190', 'p51']) {
    const { scene: full } = await loadModel(kind);
    full.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    extra.add(full);
    await fighters.far.load(kind);
  }
  for (const p of pilot.warmParts()) extra.add(p);
  const turrets = [bomber.interior?.topCockpit, bomber.interior?.ballCockpit].filter((c) => c && !c.parent); // (the turrets round your head: on the camera only while you're in them)
  for (const c of turrets) extra.add(c);
  extra.position.set(0, 0, -30); // (in front of the camera, for the shadow and depth passes too)
  scene.add(extra);
  // (compiled for the off-screen target the game draws into: a shader for the screen is a different one)
  const prev = r.getRenderTarget();
  r.setRenderTarget(gfx.composer.renderTarget1);
  try { await r.compileAsync(scene, camera); } catch { r.compile(scene, camera); }
  await breakup.warmCut(bomber.group, r, camera);
  breakup.warm(r, camera); // (the neighbours' and far bombers' broken pieces: again, for the off-screen target)
  r.setRenderTarget(prev);
  // and every texture sent to the GPU now (the first P-51 close by stalled on its textures going up)
  const sent = new Set();
  extra.traverse((o) => { for (const m of [o.material].flat()) if (m) for (const v of Object.values(m)) if (v?.isTexture && !sent.has(v)) { sent.add(v); r.initTexture(v); } });
  // (one real frame: the post-processing and the shadow maps; nothing culled, so every shadow caster's
  // depth shader is made now, wherever the sun's shadow camera happens to be)
  const culled = []; scene.traverse((o) => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
  gfx.render();
  for (const o of culled) o.frustumCulled = true;
  scene.remove(extra);
  for (const p of pilot.warmParts()) p.removeFromParent();
  for (const c of turrets) c.removeFromParent();
  for (const o of shown) o.visible = false;
  world.warmSkies(); // (the night sky's shader, so changing the time of day doesn't stall either)
  // the winter countryside's texture takes a moment to paint: done while nothing's happening, not when winter's picked
  (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 2000)))(() => world.winterGround());
}

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
  else if (e.code === 'Escape' && state === 'choosing' && roleBack) backToPause();
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
    record: stats.lives ? ui.lifeCard(stats.life, 'That life') : '',
    bombers, crewOf: (b) => crews.get(b), mine: bomber, onPick: takeSeat, onRole: chooseRole,
  });
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
    // (both models uncut first: the parts each has lost go with its damage, and are cut again on whichever
    // model it has now. Kept, your full model would have stayed cut where the wreck you left was torn)
    breakup.release(bomber); breakup.release(target);
    swapBombers(bomber, target);
    clearScars(); // (another bomber's skin: her own holes aren't kept)
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
  ui.log(`You are now ${member.role.title.toLowerCase()} ${member.name}, ${bomber.label || 'lead squadron'}.`);
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
    score: stats.mission, lives: stats.lives, forces: { b: bomberCounts(), f: fighters.counts() },
  }, () => location.reload(), (q) => gfx.setQuality(q), mode);
}

function gameOver(title) {
  state = 'over';
  clearTimeout(seatTimer);
  audio.fighterDrone(Infinity, 0);
  player.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  ui.hurt(null);
  ui.menu({ kind: 'over', kicker: 'Mission failed', title, stamp: 'Lost', text: `Fighters shot down: ${fighters.kills}.`, body: stats.lives ? ui.lifeCard(stats.mission, 'Whole mission') : '',
    button: 'Fly again', onClick: () => location.reload(), quality: gfx.qualityName, onQuality: (q) => gfx.setQuality(q) });
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

/** How the bomber stream stands: healthy, damaged (any part below 70%), shot down. */
function bomberCounts() {
  const c = { total: bombers.length, healthy: 0, damaged: 0, down: 0 };
  for (const b of bombers) { if (b.down || b.gone) c.down++; else if (b.damaged) c.damaged++; else c.healthy++; }
  return c;
}
let forcesT = 0;
const BALL_STRETCH = 1.6; // (your bomber's length as you see it from the ball)
let cabinHidden = false; // (the cabin's contents hidden while you're in the ball)

// the ball's K-4 sight: its range ring framing the nearest enemy fighter ahead (a wingspan of ~10 m), as
// the gunner set it with his foot; back to its standing range with nothing in front of it
const _br = new THREE.Vector3(), _bd = new THREE.Vector3();
let ballK = 1;
function ballRange() {
  camera.getWorldPosition(_br); camera.getWorldDirection(_bd);
  let best = Infinity;
  for (const f of fighters.list) {
    if (!f.alive || f.side !== 'axis') continue;
    const dx = f.pos.x - _br.x, dy = f.pos.y - _br.y, dz = f.pos.z - _br.z, d = Math.hypot(dx, dy, dz);
    if (d < best && d < 1200 && (dx * _bd.x + dy * _bd.y + dz * _bd.z) / d > 0.94) best = d;
  }
  const want = best < Infinity ? THREE.MathUtils.clamp(Math.atan(5 / best) / 0.05, 0.35, 1.6) : 1;
  ballK += (want - ballK) * 0.08;
  bomber.interior?.ballCockpit?.userData.setRange?.(ballK);
}

// About a third of the bombers are lost on a mission like this one (35%): the enemy's fire on the other
// bombers is weighted, a little at a time, to keep the losses on that course: few early on, most of
// them in the fight round the target. (Your own bomber's odds are its own: fighters.js, flak.js.)
const LOSS_GOAL = 0.35, MISSION_LENGTH = 480; // s: outbound, the bomb run and the run home
let lossT = 0;
function steerLosses() {
  const c = bomberCounts(), p = Math.min(1, missionTime / MISSION_LENGTH);
  const want = LOSS_GOAL * p ** 1.3, have = c.down / Math.max(1, c.total);
  fighters.lossBias = flak.lossBias = THREE.MathUtils.clamp(1 + (want - have) * 10, 0.25, 3.5);
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
    behind: bomber.base.z - bomber.home.z, // (+: aft of your slot)
    // losing speed for want of power: which engine, and whether the throttle's up far enough
    power: bomber.deadEngines || bomber.engines.some((e) => e.state === 'smoking') ? { need: bomber.throttleNeeded, lost: bomber.engines.map((e, i) => (e.state === 'ok' ? null : { n: i + 1, state: e.state, feathered: e.feathered })).filter(Boolean) } : null,
    nose: _nose.z < 1 ? { x: (_nose.x + 1) / 2, y: (1 - _nose.y) / 2 } : null,
  };
}

const _sunLocal = new THREE.Vector3(), _bq = new THREE.Quaternion(), _wInv = new THREE.Matrix4();

// ---------- loop ----------
const timer = new THREE.Timer();
let t = 0, missionTime = 0;
const _brk = new THREE.Vector3();
const failed = new Set();
/** Run one part of the frame; if it throws, log it once and carry on, so the game never freezes. */
function safely(name, fn) {
  const prof = window.__prof, t0 = prof ? performance.now() : 0; // (a timing hook for the frame-time tests)
  try { fn(); } catch (err) {
    if (!failed.has(name)) { failed.add(name); console.error(`[${name}] failed this frame:`, err); }
  }
  if (prof) prof.parts[name] = (prof.parts[name] ?? 0) + performance.now() - t0;
}
gfx.renderer.setAnimationLoop((now) => {
  timer.update(now);
  const rawDt = timer.getDelta(), dt = Math.min(rawDt, 0.05);
  const live = state === 'playing';
  const running = live || state === 'menu'; // the world stands still while paused or picking a seat
  if (running) {
    t += dt;
    safely('world', () => { world.update(dt, AIRSPEED); world.follow(eject.active ? eject.pos : mode === 'crew' || !pilot.f ? bomber.group.position : pilot.f.pos, mode === 'crew' && !eject.active && !player.away && !player.dead); });
    safely('bombers', () => {
      const controls = live && mode === 'crew' ? player.controls : null;
      bomber.manualFires = !!controls;
      for (const b of bombers) {
        if (live) b.fly(dt, b === bomber ? controls : null); // you at the controls, or the AI pilot holding (or regaining) the slot
        b.update(t, dt);
        if (live) b.updateDamage(dt, effects);
      }
      detail.update(dt);
      breakup.track(bombers);
      breakup.update(live ? dt : 0, camera.getWorldPosition(_brk));
      fleet.update();
      contrails.update();
    });
  }
  if (mode === 'crew' && !eject.active) safely('player', () => player.update(live ? dt : 0));
  if (mode === 'crew' && !eject.active) safely('shafts', () => {
    bomber.interior.updateShafts(_sunLocal.copy(world.sunDir).applyQuaternion(_bq.copy(bomber.group.quaternion).invert()));
    (bomber.interior.dust ??= new Dust(bomber.interior)).update(dt, camera, _sunLocal, gfx.quality.dust && !player.away); // dust in the sunbeams
  });
  else if (bomber.interior?.dust) bomber.interior.dust.mesh.visible = false;
  if (running) {
    if (live) {
      safely('crew', () => {
        pickActiveGunners(dt);
        crew.setDisplaced(mode === 'crew' && !eject.active ? player.station?.id : null, mode === 'crew' && !eject.active && !player.away && !player.dead && !player.wounded ? player.feet : null);
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
      if (player.extinguishPressed) { const t = bomber.engineTrouble; if (t?.fire) bomber.pullBottle(t.i); player.extinguishPressed = false; }
      if (player.featherPressed) { const t = bomber.engineTrouble; if (t?.feather) bomber.feather(t.i); player.featherPressed = false; }
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
      if ((lossT -= dt) <= 0) { lossT = 1; steerLosses(); }
      safely('flak', () => flak.update(dt));
    }
    safely('bullets', () => weapons.bullets.update(dt, camera.getWorldPosition(camPos), collide));
    safely('effects', () => effects.update(dt));
    safely('weather', () => { // rain past the windows (not inside your own bomber), lightning and its thunder
      camera.getWorldPosition(camPos);
      const inside = mode === 'crew' && !eject.active;
      world.weather(live ? dt : 0, camPos, inside ? _wInv.copy(bomber.group.matrixWorld).invert() : null, (d) => audio.thunder(d));
      WET.value = Math.min(1, (world.look.rain ?? 0) * 0.8); // (drops on the real glass: environment.js wetGlass)
    });
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
  safely('map', () => {
    const open = live && mapHeld && state === 'playing';
    if (open && (mapT -= dt) <= 0) { mapT = 0.2; ui.missionMap(missionMapData()); } // redrawn a few times a second
    else if (!open && mapT !== 0) { mapT = 0; ui.missionMap(null); }
  });
  if (live) {
    safely('hud', () => {
      ui.mission(mission.status(missionTime));
      ui.lifeStats(stats.life);
      if ((forcesT -= dt) <= 0) { forcesT = 0.3; ui.forces(bomberCounts(), fighters.counts()); } // a few times a second
      if (eject.active) { // under the parachute: the battle goes on above you
        ui.you(null);
        ui.hud({ location: eject.t > 1.8 ? 'Under the parachute' : 'Bailing out', prompt: '', atStation: false });
        ui.ejected(ui.lifeCard(stats.life, eject.from === 'crew' ? 'That life' : 'This sortie'), eject.ready);
        tags.update(camera, fighters.list, { side: fighters.playerSide });
        return;
      }
      if (mode !== 'crew') { // flying a fighter
        ui.you(null);
        ui.hud({ location: pilot.f ? `${pilot.f.k.name} · ${pilot.view === 'look' ? 'looking round' : pilot.alive ? 'cockpit' : 'shot down'}` : '', prompt: '', atStation: true });
        if (pilot.f) { ui.fighter(pilot.status(camera)); ui.fighterDamage(pilot.f); }
        tags.update(camera, fighters.list, { side: fighters.playerSide, lead: pilot.alive, self: pilot.f, bombers });
        return;
      }
      const inBall = player.station?.id === 'ball' && player.blend > 0.9;
      ui.hud({ location: player.location, prompt: player.prompt, atStation: !!player.station, looking: player.freeLooking, reflector: inBall });
      audio.turretWhine(inBall ? player.turretSpeed ?? 0 : 0);
      if (inBall) ballRange();
      // (and her length: from right under the belly the wide view squashes her, the tail on top of you;
      // drawn stretched along her length about the ball, only for you, only while you're in it)
      { const k = inBall ? BALL_STRETCH : 1, zc = -0.13, piv = weapons.positions.get('ball')?.pivot;
        if (bomber.model.scale.z !== k) {
          // (the ball's own guns are taken out of the stretch first: stretched with her, they'd bend off their line)
          if (piv && k !== 1) bomber.group.attach(piv);
          bomber.model.scale.z = k; bomber.model.position.z = zc * (1 - k); bomber.model.updateMatrixWorld(true);
          if (piv && k === 1) bomber.model.attach(piv);
        } }
      // (from the ball you see out only: not the cabin floor or the men standing on it, through her skin.
      // Its contents hidden, not the cabin itself: its lights stay, or every shader would be rebuilt)
      if (bomber.interior && inBall !== cabinHidden) {
        cabinHidden = inBall;
        for (const c of bomber.interior.group.children) {
          if (c.isLight) continue;
          if (inBall) { c.userData.shownBeforeBall = c.visible; c.visible = false; } else c.visible = c.userData.shownBeforeBall ?? true;
        }
      }
      const [rows, key] = controlsFor(player);
      ui.controls(rows, key);
      ui.gun(weapons.status(player));
      ui.crew(crew.members);
      ui.engines(bomber, !!player.station?.flies);
      ui.you(player.dead ? 0 : player.health);
      ui.health(bomber.health, bomber.bottles, bomber);
      ui.flight(flightHud());
      tags.update(camera, fighters.list, { side: 'allied', lead: !!weapons.current(player) && !mission.atSight });
    });
  }
  ui.tick(rawDt);
  safely('figures', syncFigures); // the crew's poses onto their skeletons
  if (gfx.ssao) gfx.ssao.enabled = !(mode === 'crew' && player.station?.id === 'ball' && player.blend > 0.5); // (in the ball you see out only through its window: no shading from what's behind its steel)
  safely('render', () => gfx.render());
  const prof = window.__prof;
  if (prof) { const all = Object.values(prof.parts).reduce((a, b) => a + b, 0); prof.sum ??= {}; prof.frames = (prof.frames ?? 0) + 1; for (const k in prof.parts) prof.sum[k] = (prof.sum[k] ?? 0) + prof.parts[k]; if (all > 40) prof.slow.push([+(performance.now() / 1000).toFixed(1), Math.round(all), Object.entries(prof.parts).filter(([, v]) => v > 8).map(([k, v]) => `${k} ${Math.round(v)}`).join(' ')]); prof.parts = {}; }
});

// handy for testing from the browser console
Object.assign(window, { game: { THREE, PART, crewInfo, walkSweep: () => walkSweep(player), scene, camera, player, bomber, bombers, get crew() { return crew; }, crews, gfx, world, weapons, fighters, effects, flak, mission, showSeatMap, takeSeat, audio, missionComplete, pilot, chooseRole, showRoleMenu, ui, pilotStats, stats, eject, bailOut, addScar, breakup, get mode() { return mode; }, skip: (s) => { missionTime += s; } } });
