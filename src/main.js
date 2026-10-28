// Game entry point: builds the scene, loads the planes and runs the loop.
import * as THREE from 'three';
import { Graphics } from './graphics.js';
import { World, ALTITUDE } from './world.js';
import { loadModel } from './models.js';
import { Bomber, AIRSPEED, swapBombers, PART, FORMATION, EYE } from './bomber.js';
import { Player } from './player.js';
import { GameAudio } from './audio.js';
import { Radio } from './radio.js';
import { Weapons } from './weapons.js';
import { Effects } from './effects.js';
import { Fighters, AXIS_TOTAL, ALLIED_TOTAL } from './fighters.js';
import { UI } from './ui.js';
import { formationSlots, Fleet, Contrails, Detail } from './formation.js';
import { groupAircraft, identityOf, crewByRole, CHARTED } from './history.js';
import { applyMarkings } from './markings.js';
import { FormationDebug, formationDebugOn } from './formationdebug.js';
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
import { StreamBattle } from './streambattle.js';
import { DETAIL } from './cabinlook.js';
import { SCARS, bakeBomberSpace, scarMaterial, addScar, flushScars, clearScars } from './scars.js';
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
// the crew on the intercom: what they'd call out of what the game logs is said aloud, by the man who'd say it
const radio = new Radio(audio, ui.log.bind(ui));
{ const log = ui.log.bind(ui); ui.log = (text) => { if (!radio.hear(text)) log(text); }; }
radio.onCaption = (who, text) => ui.caption(who, text); // (and shown while he says it)


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
for (const [i, b] of bombers.entries()) b.unit = slots[i].unit ?? null; // (its place in the order of battle: division, wing, group, squadron: oob.js)
// who each bomber was: the group's aircraft from the records (history.js) into its slots, the ship the
// records name as the group's lead into the lead slot, the aborts last; the other places aren't documented,
// so which record flies which slot is the game's choice (the panel says so). A bomber with no record left
// for it is unknown: no serial, no name, its crew placeholders.
{
  const byGroup = new Map();
  for (const b of bombers) if (b.unit) (byGroup.get(b.unit.group) ?? byGroup.set(b.unit.group, []).get(b.unit.group)).push(b);
  // (the lead: a record saying it led the group, or carrying the force's air commander, Col. Peaslee; a
  // ground spare that never flew isn't one of the sorties)
  const text = (r) => `${r.formation_position ?? ''} ${r.notes ?? ''}`;
  const rank = (r) => (/(^|\W)group lead|lead aircraft|Peaslee/i.test(text(r)) ? 0 : r.mission_outcome === 'aborted' ? 2 : 1);
  for (const [group, list] of byGroup) {
    const records = groupAircraft(group).filter((r) => !r.did_not_fly && !/did not fly|ground spare/i.test(text(r))).sort((a, c) => rank(a) - rank(c));
    list.sort((a, c) => (c.lead ? 1 : 0) - (a.lead ? 1 : 0));
    const give = (b, r, chart) => {
      b.ident = { ...identityOf(r, group), unit: `${b.unit.group}${b.unit.part ? `-${b.unit.part}` : ''}`, slotDocumented: !!chart || (!!r && rank(r) === 0 && b.lead), slotBasis: chart?.basis ?? null };
      b.histCrew = crewByRole(r);
      b.histRecord = r;
      if (b.model) applyMarkings(b.model, b.ident);
    };
    // first the aircraft the group's own chart places (slots.json), each into exactly its slot
    const placed = new Set(), used = new Set();
    for (const r of records) {
      const c = r.serial_number && CHARTED.get(r.serial_number);
      const b = c && list.find((x) => !placed.has(x) && x.unit.squadron === c.squadron && x.unit.element === c.element && x.unit.wingman === c.wingman);
      if (b) { give(b, r, c); placed.add(b); used.add(r); }
    }
    // then the rest in order, the lead ship first
    const rest = records.filter((r) => !used.has(r) && !(r.serial_number && CHARTED.has(r.serial_number)));
    for (const b of list) if (!placed.has(b)) give(b, rest.shift() ?? null, null);
  }
}
const bomber = bombers[slots.findIndex((s) => s.player)]; // the player's: always this object (see swapBombers)
const formationDebug = formationDebugOn ? new FormationDebug(scene, camera, bombers) : null; // (?debug=formation: the developer's look at the formation)
// ---------- historical outcomes (Options): the records' fates weight the battle ----------
// A bomber recorded as lost or written off that day is the likeliest to be brought down, one that came home
// the least (fighters.js, flak.js, streambattle.js multiply their fire on her by histK); a recorded abort
// turns back early on. How each loss happened isn't staged (mostly it isn't known): only the odds lean
// towards what the records say, and the losses' governor still sets how many.
const HIST_K = { lost: 8, written_off: 5, returned_damaged: 0.5, bombed: 0.1, aborted: 0.1, unknown: 1 };
let historical = false;
function setHistorical(on) {
  historical = !!on;
  for (const b of bombers) b.histK = historical && b.histRecord ? HIST_K[b.histRecord.mission_outcome] ?? 1 : 1;
}
function historicalAborts() {
  if (!historical) return;
  for (const b of bombers) {
    if (b === bomber || b.down || b.gone || b.histRecord?.mission_outcome !== 'aborted') continue;
    b.abortAt ??= 40 + Math.random() * 120; // s into the mission: a supercharger, an engine, oxygen, guns
    if (!b.aborting && missionTime > b.abortAt) b.aborting = new THREE.Vector3(Math.sign(b.slot0.x || 1) * 3, -1.2, 16); // out of the box, down and back (bomber.js flies it)
    if (b.aborting && b.base.distanceTo(b.slot0) > 1500) { b.gone = true; b.aborted = true; } // (gone home: off the battle)
  }
}
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
ui.fullscreen(); // (the full-screen buttons and Alt+Enter)
ui.sound((v, muted, mix) => audio.setVolume(v, muted, mix)); // (the menus' mute button and volume line, and the mix)
// the menus answer you: a tick on what you can press, a click when you press it (sound starts at the first click)
{
  const PRESSABLE = '.btn, .seat-btn[data-seat], .crew-row:not(:disabled), .role-card, .tool, .tab, .z, [data-z], .icon-btn';
  let over = null;
  document.addEventListener('pointerover', (e) => { const el = e.target.closest?.(PRESSABLE); if (el && el !== over && state !== 'playing') audio.uiTick('hover'); over = el; });
  document.addEventListener('pointerdown', (e) => { if (state === 'playing') return; audio.ensure(); if (e.target.closest?.(PRESSABLE)) audio.uiTick('select'); });
}
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
radio.fighters = fighters; // (where its calls of the fighters came from)
const collide = (a, b, team, owner, cannon, src) => fighters.collide(a, b, team, owner, cannon, src);
// what you play: 'crew' (a B-17 crewman), 'bf109', 'fw190' or 'p47' (flying a fighter yourself)
const AXIS_ROLES = new Set(['bf109', 'fw190']);
let mode = 'crew';
const pilot = new Pilot(audio);
fighters.pilot = pilot;
ui.hudOptions((o) => { Object.assign(tags.opts, o); pilot.plainSight = o.plainSight; pilot.third = player.third = o.third; weapons.infinite = pilot.infinite = o.infinite; setHistorical(o.historical); }); // (which markers are drawn, which fighter sight, which view: the Options tab)
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
const pilotStats = { bombers: 0, fighters: 0, saved: 0, deaths: 0 }; // (flying a fighter only: not your kills at a B-17's guns)
const stats = new Stats(); // your score, this life and the whole mission
const eject = new Eject(scene); // hanging under a parachute after bailing out
let bailedOut = false;
// the fighters report your hits, crits, kills and assists
fighters.onSaved = () => pilotStats.saved++; // (an attack you broke up in your P-47)
fighters.report = (kind, name, dmg) => {
  if (kind === 'hit') { stats.hit(dmg); return; }
  if (kind === 'kill' && mode !== 'crew') pilotStats.fighters++;
  if (kind === 'kill') stats.kill(); else if (kind === 'assist') stats.assist(); else stats.crit();
  ui.banner(kind, name, POINTS[kind]);
  audio.chime(kind);
};

// ten men in every bomber. You're the radio operator of yours; your crew are visible figures.
const crews = new Map(bombers.map((b) => [b, new Crew(b, b === bomber ? { visible: true, playerRole: 'radio', interior: bomber.interior } : {})]));
radio.crews = crews; // (the other Forts' pilots, by name: "they're going for Miller's ship!")
let crew = crews.get(bomber); // the crew you're part of (changes when you move to another bomber)
// (you can only be hurt aboard while you're a crewman, not while you're off flying a fighter)
// another B-17 bumping yours: the jolt through the airframe and the crunch of it (fighters.bomberContact)
// flak fragments through a bomber's fuselage: the men inside take them, and your bomber's skin shows the holes
function onShrapnel(b, from, n) {
  if (b !== bomber) n = Math.round(n * THREE.MathUtils.clamp((flak.lossBias ?? 1) * (flak.groupBias?.get(b.squad) ?? 1), 0.4, 1)); // (the losses' governor spares the other crews a little, as onBomberHit)
  const holes = crews.get(b).shrapnel(from, n, b === bomber && mode === 'crew' && !player.away ? player : null);
  if (b === bomber) for (const h of holes) addScar(b, h.at, h.dir, false);
}
fighters.onBumped = (k, level) => { if (mode === 'crew' && !player.away) { player.jolt(Math.min(1, k * 1.3)); audio.impact(level > 0); if (level > 0) audio.flakClose(k); shake = Math.max(shake, k); } };
fighters.onBomberHit = (b, part, local, cannon, dir) => {
  if (b === bomber && dir) addScar(b, local, dir, cannon); // a hole in her skin where it went in
  // (the men in the rest of the stream are spared as her airframe is, by the losses' governor: else whole
  // flight decks die while the hits are held back, and the bombers go down with nobody at the controls)
  // (but never below 40%: the bombers that come home bring their dead and wounded with them)
  if (b !== bomber && Math.random() > Math.max(0.4, (fighters.lossBias ?? 1) * (fighters.groupBias?.get(b.squad) ?? 1))) return;
  crews.get(b).onHit(part, local, cannon, b === bomber && mode === 'crew' ? player : null);
};
const flak = new Flak({ effects, audio, ui, bombers, playerBomber: bomber, onBomberHit: fighters.onBomberHit, onShrapnel,
  onClose: (k) => { if (mode === 'crew' && !player.away && !eject.active) { player.jolt(k); audio.flakClose(k); shake = Math.max(shake, k); } } }); // (felt inside your bomber)
player.onSightRefused = () => ui.log(mission.phase === 'outbound' ? `Bombsight: nothing to aim at yet. ${mission.status(missionTime).replace(/^Outbound · /, '')}.` : 'Bombsight: the bombs are away.');
flak.ear = camera; // (the flak heard from where you are: in your bomber or a fighter)
flakEnv = () => { flak.night = env.time === 'night' ? 1 : env.time === 'twilight' ? 0.45 : 0; flak.muffle = WEATHER[env.weather]?.overcast ?? 0; };
flakEnv();
const mission = new Mission(scene, { effects, audio, ui, bombers, playerBomber: bomber });
world.drift.add(mission.target.group); // (the target on the ground: swings round with it in a turn)
// ---------- the rally turn: right onto 130 degrees, from the bomb run's 58 (the 351st's briefing) ----------
// The formation is the frame the game is played in, so it turns by the world turning under it: the ground,
// the clouds, the target, the sky and the sun swing round (world.setHeading), every bomber banked into the
// turn (FORMATION.bank). It starts once your wing's bombs are down (the mission's own track never turns:
// the wings behind still bomb on it).
const RALLY_TURN = THREE.MathUtils.degToRad(130 - 58), RALLY_RATE = THREE.MathUtils.degToRad(1.2); // rad; rad/s (a gentle, heavy turn)
let rallyAt = null, heading = 0;
function rallyTurn(dt) {
  if (rallyAt == null && (mission.phase === 'rally' || mission.phase === 'homeward')) rallyAt = missionTime + 45; // (the last bombs on the ground first)
  if (rallyAt == null || missionTime < rallyAt || heading >= RALLY_TURN) { FORMATION.bank *= Math.exp(-dt * 0.6); return; }
  const left = RALLY_TURN - heading, rate = RALLY_RATE * Math.min(1, (missionTime - rallyAt) / 8, left / THREE.MathUtils.degToRad(8)); // (rolling in and out of it)
  const step = Math.min(RALLY_TURN - heading, Math.max(rate, 0.0005) * dt);
  heading += step;
  world.setHeading(heading);
  mission.target.center.applyAxisAngle(_UP, step); // (a point on the ground swings round the turning formation)
  const want = Math.atan((rate * 99) / 9.81); // (the bank that turns her at that rate: 99 m/s true airspeed)
  FORMATION.bank += (want - FORMATION.bank) * (1 - Math.exp(-dt * 0.8));
}
const _UP = new THREE.Vector3(0, 1, 0), _miniTgt = new THREE.Vector3();
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
const viewHinted = new Set(); // (the V hint, once a game for the B-17 and once for the fighters)
let miniT = 0; const _miniAt = new THREE.Vector3(), _miniDir = new THREE.Vector3(); // (the mini map)
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
    : 'Click to capture the mouse. If it never captures, open the game in its own Chrome or Edge tab: this window doesn\'t allow it.');
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
      kind: 'start', kicker: 'Eighth Air Force · 14 October 1943', title: 'Black Thursday', sub: 'B-17 Flying Fortress', stamp: 'Restricted',
      text: 'Mission briefing: Schweinfurt, the ball-bearing works, deep in Germany. The Thunderbolts can only take you as far as the border; after that you are on your own. Fly with the stream, or against it.',
      facts: [['Target', 'Schweinfurt'], ['Altitude', '25,000 ft'], ['Force', `${bombers.length} B-17s`], ['Escort', `${ALLIED_TOTAL} P-47s (to the border)`], ['Opposition', `${AXIS_TOTAL} fighters`], ['Conditions', envLabel(env)]],
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
      engines: 4 - bomber.deadEngines, crewFit: crew.members.filter((m) => m.state === 'ok' || m.state === 'player').length, crewMen: menCount(crew),
      life: stats.life, mission: stats.mission, lives: stats.lives, forces: bomberCounts(),
    },
    button: 'Resume', onClick: play, quality, onQuality,
    seats: mode === 'crew' && !player.away && !player.dead && !player.wounded && !player.ridingTail && !eject.active ? seatList() : null,
    onSeat: (id) => { moveToSeat(id); play(); },
    actions: [{ label: 'Change aircraft', onClick: () => showRoleMenu('Change aircraft', true) }, { label: 'Controls', onClick: () => ui.drawer('controls') }, { label: 'Options', onClick: () => ui.drawer('options') }, { label: 'Settings', onClick: () => ui.drawer('settings') },
      { label: 'Quit to menu', confirm: 'Click again to quit', onClick: quitToMenu }],
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
    // the man by name (his rank and surname), his job under it if it isn't this position's name
    const who = id === 'tail' && bomber.noTail ? 'Lost with the tail' : !m ? 'No one' : m.state === 'player' ? 'You' : m.name;
    const job = [m && m.role.title.toLowerCase() !== name.toLowerCase() && m.state !== 'player' ? m.role.title : '', m?.patched && m.state !== 'dead' ? 'wounded once' : ''].filter(Boolean).join(' · ');
    return { id, name, who, job, state, here, can: !out && m?.state !== 'dead' };
  });
}
function moveToSeat(id) {
  const st = STATIONS.find((s) => s.id === id);
  const health = player.health;
  player.becomes(st.stand, st.yaw);
  player.health = health; // (the same man, moving: his wounds go with him)
  player.near = st; player.passage = null; player.interact(); // (straight onto it: his man steps aside, as when you walk up to it)
}

// ---------- roles: B-17 crewman, Bf 109 pilot, P-47 pilot ----------
/** The crewman you were leaves the game: an AI man takes his post (only if he's alive and well). */
function leaveCrew() {
  const me = crew.members.find((m) => m.state === 'player');
  if (me && !player.dead && !player.wounded) { me.state = 'ok'; me.standIn = false; me.task = 'station'; crew.place(me); }
  else if (me && player.dead) { me.state = 'dead'; me.spot = { ...me.spot, lie: player.feet.toArray(), liePose: 'lie' }; crew.place(me); } // (killed, and away before the seat map came: he stays where he fell)
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
  clearTimeout(seatTimer); // (a seat map still to come from your last death: you've chosen already)
  mapBack = null;
  if (id === 'crew') {
    // the formation plot, every time: pick any bomber, then the man you'll fly as. Nothing changes until
    // you do: Back (or Esc) returns to the menu you came from as it was
    const from = state === 'menu' ? () => { state = 'menu'; showMenu(false); } : roleBack ? () => showRoleMenu('Change aircraft', true) : () => showRoleMenu(lastRoles);
    roleBack = false;
    showSeatMap('Pick your bomber', from);
    return;
  }
  roleBack = false;
  roleBusy = true;
  eject.stop(); ui.ejected(null); bailedOut = false;
  if (mode === 'crew') leaveCrew(); else leaveFighter();
  mode = id;
  fighters.crewView = false;
  fighters.playerSide = AXIS_ROLES.has(id) ? 'axis' : 'allied';
  scene.attach(camera); // the camera leaves the bomber: it follows your fighter
  camera.up.set(0, 1, 0);
  ui.hurt(null); ui.sight(null); ui.aid(null);
  try {
    const f = await fighters.spawnPlayer(id);
    pilot.start(f, fighters);
    stats.newLife(id);
  } finally { roleBusy = false; }
  pilotDeathT = 0; p47Fuel = null;
  play();
  ui.log(id === 'bf109' ? 'Bf 109, JG 26. Break up the bomber stream!' : id === 'fw190' ? 'Fw 190, IV.(Sturm)/JG 3. Go through the bombers head-on!' : 'P-47, 56th Fighter Group. Cover the bombers as far as your fuel takes you!');
}

// your P-47's fuel: when the escort turns back (fighters.js, ESCORT_FUEL) you have a little longer, then
// you have to go too (joining after that, you've only that little)
const P47_GRACE = 40; // s
let p47Fuel = null;
function fighterFuel(dt) {
  if (mode !== 'p47' || !pilot.alive || eject.active || state !== 'playing') return;
  if (p47Fuel == null) {
    if (!fighters.escortsHome) return;
    p47Fuel = P47_GRACE;
    ui.toast('Bingo fuel! Turn for home soon.', 'warn');
  }
  p47Fuel -= dt;
  ui.hint(p47Fuel > 0 ? `Fuel low: you must turn for home in ${Math.ceil(p47Fuel)} s` : '');
  if (p47Fuel <= 0) { ui.hint(''); showRoleMenu('Out of fuel: you turned for home'); }
}

/**
 * Shot down as a fighter pilot. If you're still alive (not hit yourself, not into the ground) you bail
 * out a moment later and hang under your chute; otherwise a few seconds watching the fall, then pick again.
 */
function fighterLife(dt) {
  fighterFuel(dt);
  if (pilot.alive || eject.active) { if (pilot.alive) pilotDeathT = 0; return; }
  const f = pilot.f;
  if (pilotDeathT === 0 && !bailedOut) { pilotStats.deaths++; ui.toast(f?.killedBy === 'ground' ? 'You flew into the ground.' : 'You\'ve been shot down!', 'kill'); pilot.firing = false; }
  pilotDeathT += dt;
  // torn apart (a collision, a wing or the tail gone, blown up, into the ground): no getting out. The camera
  // stays with her a few seconds, the explosion and the pieces, then the menu. Going down whole: you bail out
  const wrecked = f && (f.killedBy === 'collision' || f.killedBy === 'ground' || f.wingGone || f.tailGone || f.state === 'gone' || f.pilotDead);
  if (!bailedOut && f && !wrecked && pilotDeathT > 1.2) { startEject(f.pos, f.velocity, 'fighter'); return; }
  if (pilotDeathT > (wrecked ? 3.8 : 4) && state === 'playing') showRoleMenu(f?.killedBy === 'collision' ? 'You collided' : 'You were shot down');
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
  player.hatch = null; // (or leaving the seat beside the crawlway hatch would go out through it again, and again)
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
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyJ' || e.repeat) return;
  if (eject.active) { eject.pull(); return; } // the ripcord
  if (mode !== 'crew') { bailOut(); return; }
  // in a B-17: ring the bail-out bell (the pilot's order: anyone may when she's finished): the hatches lit,
  // the crew going for them; you get out through one (E at it: in the pilots' seats, the one beside you)
  if (state === 'playing' && !player.away && !player.dead && !bailOrdered) { bailOrdered = true; ui.log('You rang the bail-out bell. Abandon ship!'); }
});
// ---------- going down: the bail-out bell, the hatches lit red, the crew going for them ----------
const HATCHES = [ // in bomber space (x, z): the main door aft of the waist, the tail door, the bomb bay, the nose hatch
  { name: 'the main door', at: [0.72, 4.45] }, { name: 'the tail door', at: [0.45, 8.6] }, { name: 'the bomb bay', at: [0, -4.4] }, { name: 'the nose hatch', at: [-0.35, -8.25] },
  { name: 'the nose hatch, down the crawlway', at: [0, -7.55], y: -0.40 }, // (from the flight deck: down past the panel and out under the nose)
].map((h) => ({ ...h, pos: new THREE.Vector3(h.at[0], h.y ?? bomber.interior?.floorAt(h.at[0], h.at[1], 2) ?? -1.9, h.at[1]) }));
let bellT = 0, bailCalled = false, bailOrdered = false;
let shake = 0; const _brassQ = new THREE.Quaternion(); // (how hard she's being thrown about, for the brass on the floor)
function goingDown(dt) {
  const on = (bomber.down || bailOrdered) && mode === 'crew' && !player.away && !player.dead && !player.ridingTail && !eject.active && state === 'playing';
  // (the ones still there: none on a tail that's gone, nor the main door with the waist broken away)
  player.hatches = on ? HATCHES.filter((h) => !(bomber.noTail && h.pos.z > 5.2) && !(bomber.lost.waist && h.pos.z > -1.25)) : null;
  if (!on) { bailCalled = false; return; }
  if (!bailCalled) { bailCalled = true; ui.toast('Bail out! Get to a hatch!', 'kill'); crew.bailOut(HATCHES, effects); }
  if ((bellT -= dt) <= 0) { bellT = 0.55; audio.bell(); } // the alarm bell, on and on
}
player.onHatch = () => { bailOut(); };
addEventListener('keydown', (e) => { if (e.code === 'KeyH' && !e.repeat && state === 'playing') ui.toggleControls(); });
// I: the bomber you're in, as the records have her (history.js), and her crew
let identOpen = false;
function showIdentity() {
  ui.identity(identOpen && mode === 'crew' ? { ident: bomber.ident, crew: crew.members.map((m) => ({ title: m.role.title, name: m.name, placeholder: m.placeholder, confidence: m.historical?.confidence, fate: m.historical?.fate })) } : null);
}
addEventListener('keydown', (e) => { if (e.code === 'KeyI' && !e.repeat && state === 'playing') { identOpen = !identOpen; showIdentity(); } });
// V: the pilots' view, cockpit or third person (in a fighter, or in your B-17's pilot or co-pilot seat)
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyV' || e.repeat || state !== 'playing' || !(mode !== 'crew' ? pilot.alive : player.station?.flies)) return;
  ui.toast(ui.toggleHud('third') ? 'Third-person view (V)' : 'Cockpit view (V)');
});

/** The keys that do something where you are (the controls card): [rows, a key for where that is]. */
function controlsFor(p) {
  const s = p.station;
  if (p.wounded || p.dead) return [[], 'none'];
  if (!s) return [[['W A S D', 'walk'], ['Shift', 'hurry'], ['E', 'take a station'], ['F', 'first aid (hold, by a wounded man)'], ['M', 'formation map'], ['J', 'ring the bail-out bell'], ['E', 'then out through a red hatch']], 'walk'];
  if (s.flies) return [[['Mouse', 'steer'], ['W / S', 'throttle'], ['A / D', 'roll'], ['T', 'fire bottle, worst engine'], ['F', 'feather it'], ['1 / 2 / 3 / 4', 'a bottle on that engine'], ['C', 'hold: look round'],
    ['V', p.third ? 'view: third person' : 'view: cockpit'], ['J', 'ring the bail-out bell'], ['E', 'leave the seat']], `seat:${s.id}:${p.third}`];
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

const _ej = new THREE.Vector3(), _up = new THREE.Vector3(), _lift = new THREE.Vector3(); // (_lift: startEject's own, as `vel` may be _up)
function startEject(pos, vel, from) {
  bailedOut = true;
  pilot.stop();
  player.detachAll();
  player.enabled = false;
  scene.attach(camera);
  camera.up.set(0, 1, 0);
  ui.setMode('eject'); ui.sight(null); ui.hurt(null); ui.aid(null); ui.fighter(null);
  eject.start(_ej.copy(pos).add(_lift.set(0, 2, 0)), vel, from, () => { if (state === 'playing') finishEject(); }); // (a click on the pause menu isn't "go again")
}

function finishEject() {
  const from = eject.from;
  eject.stop();
  ui.ejected(null);
  if (from === 'crew') showSeatMap('You bailed out'); else showRoleMenu('You bailed out');
}

let mapBack = null, lastRoles = 'Pick again'; // (the plot's way back; the role menu's last title)
function showRoleMenu(title, change = false) {
  if (!change) lastRoles = title;
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
  for (const kind of ['bf109', 'fw190', 'p47']) {
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
  // and every texture sent to the GPU now (the first P-47 close by stalled on its textures going up)
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
  if (e.code === 'Escape' && state === 'playing') pause(); // (in full screen the page keeps Esc: the mouse is still captured, pause() lets it go)
  else if (e.code === 'Escape' && state === 'choosing' && mapBack) { const b = mapBack; mapBack = null; b(); }
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

  // the tail shot away: its gunner goes down with it (his parachute was stowed forward: he has none);
  // you too if you were back there, your view riding the falling tail a few seconds
  if (bomber.noTail && !tailDone && (bomber.tailPiece || (tailWait += dt) > 0.6)) { // (once the piece is there to ride)
    tailDone = true;
    const piece = bomber.tailPiece, tg = crew.members.find((m) => m.role.id === 'tail');
    if (tg && tg.state !== 'dead' && tg.state !== 'bailed' && tg.state !== 'player') {
      crew.kill(tg);
      if (piece && tg.fig) { tg.onTail = true; piece.g.attach(tg.fig); }
    }
    if (mode === 'crew' && !player.dead && !player.away && (player.station?.id === 'tail' || player.feet.z > 6.0)) {
      if (player.station) player.interact();
      player.enabled = false; player.ridingTail = true;
      if (piece) piece.g.add(camera); // (the camera keeps its place in the bomber's frame: now the falling tail's)
      ui.toast('The tail\'s gone! No parachute back here...', 'kill');
      setTimeout(() => { if (player.ridingTail) { player.dead = true; ui.log('You went down with the tail.'); } }, 3600);
    }
  }
  goingDown(dt);
  // bomber going down: some time to get out through a hatch, then she takes you with her
  if (bomber.down && !player.dead && (deathT += dt) > 24) player.dead = true;
  if (player.dead && !player.deathShown) {
    player.deathShown = true;
    ui.toast(bomber.down ? 'Your bomber is going down.' : 'You were killed.', 'kill');
    seatTimer = setTimeout(showSeatMap, 2500);
  }
}

/** "You were killed": the formation map, to carry on as any fit AI crewman on any surviving bomber (or, choosing: your pick of them). */
function showSeatMap(title = null, back = null) {
  const choosing = !!back;
  mapBack = back;
  if (state === 'over') return; // the mission ended in the meantime
  state = 'choosing';
  audio.fighterDrone(Infinity, 0); // the world stands still: no engine snarl
  player.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  ui.hurt(null);
  const me = crew.members.find((m) => m.state === 'player');
  if (me && !choosing) { // the man you were stays where he fell
    me.state = 'dead';
    me.spot = { ...me.spot, lie: player.feet.toArray(), liePose: 'lie' };
    crew.place(me);
  }
  const anyone = bombers.some((b) => !b.down && !b.gone && crews.get(b).members.some((m) => m.state === 'ok'));
  if (!anyone) { gameOver('The bombers are all gone'); return; }
  ui.map({
    title: title ?? (bomber.down ? 'Your bomber went down' : 'You were killed'),
    text: `Pick any ${choosing ? '' : 'surviving '}bomber on the map, then the crewman you will ${choosing ? 'fly as' : 'carry on as'}. Double-click a bomber to board her straight away.`,
    record: stats.lives && !choosing ? ui.lifeCard(stats.life, 'That life') : '',
    bombers, crewOf: (b) => crews.get(b), mine: bomber, onRole: chooseRole,
    onBack: back ? () => { mapBack = null; back(); } : null,
    onPick: (b, m) => {
      mapBack = null;
      if (choosing) { // now you leave what you were: your fighter, or your post (your man goes back to it)
        eject.stop(); ui.ejected(null); bailedOut = false;
        if (mode === 'crew' && !player.away && !player.dead) leaveCrew();
      }
      takeSeat(b, m);
    },
  });
}

function takeSeat(target, member) {
  clearTimeout(seatTimer);
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
    { const a = downSeen.has(bomber), b = downSeen.has(target); downSeen.delete(bomber); downSeen.delete(target); if (b) downSeen.add(bomber); if (a) downSeen.add(target); } // (seen going down goes with her state)
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
  player.patched = !!member.patched; player.role = member.role.id; // (wounded once already as that man?)
  const st = STATIONS.find((s) => s.id === member.role.station);
  player.ridingTail = false; tailDone = !!bomber.noTail; tailWait = 0; bailOrdered = false;
  player.becomes(st ? st.stand : new THREE.Vector3(0, -1.8, -1.8), st ? st.yaw : Math.PI);
  player.deathShown = false;
  deathT = 0;
  if (st) { player.near = st; player.interact(); } // straight onto his gun (or into his seat)
  state = 'playing';
  player.enabled = true;
  audio.start(); // (also resumes sound suspended by a pause before you died)
  ui.play();
  lock();
  radio.reset();
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
    crewHome: crew.members.filter((m) => m.state === 'ok' || m.state === 'wounded' || m.state === 'player').length, crewMen: menCount(crew), men: menCount(),
    pilot: { bombers: pilotStats.bombers, fighters: pilotStats.fighters, deaths: pilotStats.deaths, saved: pilotStats.saved },
    score: stats.mission, lives: stats.lives, forces: { b: bomberCounts(), f: fighters.counts() },
  }, quitToMenu, (q) => gfx.setQuality(q), mode);
}

/** Back to the briefing: the mission starts again from the top (the page reloads), saying so at once. */
function quitToMenu() {
  state = 'over';
  audio.suspend();
  ui.menu({ kind: 'loading', kicker: 'Eighth Air Force · 14 October 1943', title: 'Black Thursday', sub: 'B-17 Flying Fortress', text: 'Returning to the briefing…' });
  try { if (document.fullscreenElement) sessionStorage.setItem('bomber.fs', '1'); } catch { /* (no storage) */ } // (full screen back on after the reload)
  setTimeout(() => location.reload(), 30); // (after the screen has changed)
}

function gameOver(title) {
  state = 'over';
  clearTimeout(seatTimer);
  audio.fighterDrone(Infinity, 0);
  player.enabled = false;
  if (document.pointerLockElement) document.exitPointerLock();
  ui.hurt(null);
  ui.menu({ kind: 'over', kicker: 'Mission failed', title, stamp: 'Lost', text: `Fighters shot down: ${fighters.kills}.`, body: stats.lives ? ui.lifeCard(stats.mission, 'Whole mission') : '',
    button: 'Fly again', onClick: quitToMenu, quality: gfx.qualityName, onQuality: (q) => gfx.setQuality(q) });
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
  const c = { total: bombers.length, healthy: 0, damaged: 0, down: 0, aborted: 0, men: menCount() };
  for (const b of bombers) { if (b.aborted) c.aborted++; else if (b.down || b.gone) c.down++; else if (b.damaged) c.damaged++; else c.healthy++; } // (an abort turned back: not a loss)
  return c;
}
/** The men: in the bombers still flying (or of one crew): alive (fit), wounded (down, waiting for help), dead. */
function menCount(only = null) {
  const n = { alive: 0, wounded: 0, dead: 0 };
  for (const [b, c] of crews) {
    if (only ? c !== only : b.down || b.gone) continue;
    for (const m of c.members) { if (m.state === 'ok' || m.state === 'player') n.alive++; else if (m.state === 'wounded') n.wounded++; else if (m.state === 'dead') n.dead++; }
  }
  return n;
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
let wasOut = false; // (your bomber out of the box at the last look)
const stream = new StreamBattle({ bombers, crews, effects }); // (the battle down the rest of the stream: streambattle.js)
fighters.groupBias = flak.groupBias = stream.groupBias;
let tailDone = false, tailWait = 0; // (your bomber's tail: its loss dealt with)
/**
 * The formation as it's shot to pieces: gaps stay where bombers fell out, and the box thins and deteriorates
 * as the losses mount. Only command passes on: when an element's or the group's leader is gone, the man
 * next in line (his own wingman first, else the nearest of his squadron, for the group lead the lead
 * squadron's) moves up into the leader's slot, flown there by the autopilot (a few metres a second: it
 * takes a while), leaving his own slot empty. A group cut down below four joins the nearest group of its
 * wing with room for it, into the empty slots nearest them. Not the crippled (they can't keep up), nor yours
 * while you fly her.
 */
const GROUP_SLOTS = new Map(); // group -> its slots as it took off: { pos, lead, squadron, element, wingman }
for (const [i, b] of bombers.entries()) {
  const u = slots[i].unit;
  (GROUP_SLOTS.get(b.squad) ?? GROUP_SLOTS.set(b.squad, []).get(b.squad)).push({ pos: slots[i].pos.clone(), lead: b.lead, squadron: u?.squadron ?? 'lead', element: u?.element ?? 0, wingman: u?.wingman ?? (b.lead ? 0 : 1) });
}
for (const list of GROUP_SLOTS.values()) list.sort((p, q) => (q.lead ? 1 : 0) - (p.lead ? 1 : 0));
function reform() {
  const able = (b) => !b.down && !b.gone && !b.pilotless && !b.flown && (b.deadEngines === 0 || (b.deadEngines === 1 && (b.stragT ?? 0) > 120)) && b.drift.y > -0.5;
  const groups = new Map();
  let moved = false;
  for (const b of bombers) if (able(b)) (groups.get(b.squad) ?? groups.set(b.squad, []).get(b.squad)).push(b);
  // the remnants of a group that's all but gone join the nearest group of their wing
  for (const [g, list] of groups) {
    if (list.length >= 4) continue;
    const wing = g.split('-')[0];
    let best = null, bd = Infinity;
    for (const [h, other] of groups) {
      if (h === g || h.split('-')[0] !== wing || other.length < 4 || other.length + list.length > GROUP_SLOTS.get(h).length) continue;
      const d = other[0].base.distanceTo(list[0].base);
      if (d < bd) { bd = d; best = h; }
    }
    if (best) { for (const b of list) { b.squad = best; groups.get(best).push(b); } groups.delete(g); moved = true; }
  }
  if (moved) mission.regroup(); // (the mission's groups follow: its bomb run checks go by squad)
  const goTo = (b, slot) => { if (b.home.distanceToSquared(slot.pos) > 4) { b.home.copy(slot.pos); b.slot0.copy(slot.pos); } };
  for (const [g, list] of groups) {
    const table = GROUP_SLOTS.get(g) ?? [], held = new Map(), loose = [];
    for (const b of list) { // who's in which slot (a newcomer from a broken group: in none yet)
      const k = table.findIndex((t) => t.pos.distanceToSquared(b.slot0) < 4);
      if (k >= 0 && !held.has(k)) held.set(k, b); else loose.push(b);
    }
    for (const b of loose) { // newcomers into the empty slots nearest them
      let k = -1, bd = Infinity;
      for (const [i, t] of table.entries()) { if (held.has(i)) continue; const d = t.pos.distanceToSquared(b.base); if (d < bd) { bd = d; k = i; } }
      if (k >= 0) { held.set(k, b); goTo(b, table[k]); }
    }
    // command passing on: an empty leader's slot (the group's lead, an element's lead), the lead's first
    for (const [i, t] of table.entries()) {
      if (held.has(i) || (t.wingman !== 0 && !t.lead)) continue;
      const pick = (ok) => { let best = -1, bd = Infinity; for (const [j, b] of held) { if (!ok(table[j], j) || table[j].lead) continue; const d = b.base.distanceToSquared(t.pos); if (d < bd) { bd = d; best = j; } } return best; };
      let j = pick((u) => u.squadron === t.squadron && u.element === t.element && u.wingman !== 0); // his own wingman
      if (j < 0) j = pick((u) => u.squadron === t.squadron && (t.lead || u.wingman !== 0)); // else the nearest of his squadron
      if (j < 0 && t.lead) j = pick(() => true); // (the group's lead: anyone left)
      if (j < 0) continue;
      const b = held.get(j); held.delete(j); held.set(i, b); goTo(b, t);
    }
  }
}

let reformT = 8;
// Black Thursday: 60 of the 291 lost, a fifth of them, to the fighters and the flak (an ordinary day lost a few
// per cent). Aimed lower than that, as the fires already burning and the collisions add a few per cent it can't stop
const LOSS_GOAL = 0.16;
let lossT = 0, lossWant = 0, flakT = 0, afterFlakT = 0;
function steerLosses() {
  // the losses by now: half to the fighters on the way in (once the escort has turned back), a third more
  // over the target to the flak (engines set alight, the fire into the wing: flak.js) and the fighters
  // waiting beyond it, the rest on the way home
  if (flak.on) flakT += 1; else if (flakT > 0) afterFlakT += 1;
  const share = !flakT ? 0.5 * Math.min(1, missionTime / 220) : !afterFlakT ? 0.5 + 0.3 * Math.min(1, flakT / 180) : 0.8 + 0.2 * Math.min(1, afterFlakT / 200);
  lossWant = LOSS_GOAL * share;
  const c = bomberCounts();
  // (the bombers already burning or crippled count as partly lost: they go down without another round)
  const doomed = bombers.reduce((n, b) => n + b.peril, 0);
  const want = lossWant, have = (c.down + doomed) / Math.max(1, c.total);
  fighters.lossBias = flak.lossBias = THREE.MathUtils.clamp(1 + (want - have) * 25, 0.02, 3.5);
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
  if (!live) ui.caption(null); // (no one talking over the menus)
  if (running) {
    t += dt;
    safely('world', () => { world.update(dt, AIRSPEED); world.follow(eject.active ? eject.pos : mode === 'crew' || !pilot.f ? bomber.group.position : pilot.f.pos, mode === 'crew' && !eject.active && !player.away && !player.dead); });
    safely('bombers', () => {
      const controls = live && mode === 'crew' ? player.controls : null;
      bomber.manualFires = !!controls;
      camera.getWorldPosition(EYE); // (close props blur: bomber.js)
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
    weapons.ear = mode === 'crew' && !player.away && !player.dead && !eject.active ? camera : null; // (the spent cases heard only aboard)
    safely('weapons', () => weapons.update(live ? dt : 0, player, camera, crew, fighters));
    if (live) safely('fighters', () => fighters.update(dt, player));
    if (mode !== 'crew' && !eject.active) safely('pilot', () => pilot.updateCamera(camera, live ? dt : 0));
    if (eject.active) safely('eject', () => eject.update(live ? dt : 0, camera));
    // your own engine while you fly (silent once you're shot down), the B-17's drone otherwise
    safely('engine', () => (mode !== 'crew' && pilot.alive ? audio.ownEngine(mode, pilot.throttle, pilot.f.speed) : audio.ownEngine(null)));
    if (live) {
      missionTime += dt;
      safely('mission', () => mission.update(dt, { player, time: missionTime, flak, fighters }));
      safely('turn', () => rallyTurn(dt));
      if ((reformT -= dt) <= 0) { reformT = 8; reform(); }
      safely('stream', () => stream.update(dt, { center: bomber.group.position, want: lossWant, fighters, flak, lossBias: fighters.lossBias }));
      if ((lossT -= dt) <= 0) {
        lossT = 1; steerLosses(); historicalAborts();
        if (identOpen) showIdentity(); // (kept up to date: another seat, another bomber, a man hit)
        for (const [b, c] of crews) if (b.noTail) { const tg = c.members.find((m) => m.role.id === 'tail'); if (tg && (tg.state === 'ok' || tg.state === 'wounded')) c.kill(tg); }
        // your bomber out of the box, or back in it
        const out = bomber.straggling;
        if (mode === 'crew' && !player.away && out !== wasOut && !bomber.down) {
          if (out) { ui.toast("We're out of formation! Fighters closing in!", 'kill'); 
            // (said by whoever's flying her: the pilot, or the co-pilot once he's gone; none left, no name)
            const up = crew.alive.find((m) => m.role.id === 'pilot') ?? crew.alive.find((m) => m.role.id === 'copilot');
            ui.log(`${up ? `${up.role.title} to crew: w` : 'W'}e've lost the formation. Fighters will be on us. Watch your sectors!`);
          }
          else ui.toast('Back in formation');
        }
        wasOut = out;
      }
      flak.inside = mode === 'crew' && !player.away && !eject.active && !(player.third && player.station?.flies);
      safely('flak', () => flak.update(dt));
      safely('radio', () => {
        radio.set(mode === 'crew' && !player.away && !player.dead && !eject.active, crew, player.role);
        radio.update(dt, { phase: mission.phase, toGo: mission.sightError().along, released: !!mission.groups.get(bomber.squad)?.released, atSight: !!mission.atSight,
          flak: flak.on, time: missionTime, quietT: mission.quietT ?? 0, fighting: fighters.axis.some((f) => f.state === 'attack' && f.target === bomber), bombers, bomber });
        // the brass on the floor chinking as she moves: banking, bumping through the air, flak and hits
        const turn = _brassQ.angleTo(bomber.group.quaternion) / Math.max(dt, 1e-3);
        _brassQ.copy(bomber.group.quaternion);
        shake *= Math.exp(-dt * 2.5);
        if (weapons.ear) audio.brass(dt, Math.min(1, (weapons.casings?.lying ?? 0) / 700), Math.min(1, turn * 3 + shake));
      });
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
        ui.hud({ location: eject.falling ? 'Free fall' : 'Under the parachute', prompt: eject.falling ? '<span style="font-size:24px">Press <b>J</b> to pull your parachute</span>' : '', atStation: false });
        ui.ejected(ui.lifeCard(stats.life, eject.from === 'crew' ? 'That life' : 'This sortie'), eject.ready);
        tags.update(camera, fighters.list, { side: fighters.playerSide });
        return;
      }
      if (mode !== 'crew') { // flying a fighter
        ui.you(null);
        ui.hud({ location: pilot.f ? `${pilot.f.k.name} · ${pilot.view === 'look' ? 'looking round' : !pilot.alive ? 'shot down' : pilot.third ? 'third person' : 'cockpit'}` : '', prompt: '', atStation: true });
        ui.controls([['Mouse', 'aim where you fly'], ['W / S', 'throttle'], ['A / D', 'roll'], ['Click', 'guns'], ['C', 'hold: look round'], ['V', pilot.third ? 'view: third person' : 'view: cockpit'], ['J', 'bail out']], `fighter:${pilot.third}`);
        if (pilot.f) { ui.fighter(pilot.status(camera)); ui.fighterDamage(pilot.f); }
        if (pilot.alive && !viewHinted.has('fighter')) { viewHinted.add('fighter'); ui.toast('V: third-person view'); }
        tags.update(camera, fighters.list, { side: fighters.playerSide, lead: pilot.alive, self: pilot.f, bombers });
        return;
      }
      const inBall = player.station?.id === 'ball' && player.blend > 0.9;
      ui.hud({ location: player.location, prompt: player.prompt, atStation: !!player.station, looking: player.freeLooking, reflector: inBall || (/^waist/.test(player.station?.id ?? '') && player.blend > 0.9) }); // (the waist guns: their ring-and-post sights are the aim)
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
      if (player.station?.flies && player.blend > 0.9 && !viewHinted.has('b17')) { viewHinted.add('b17'); ui.toast('V: third-person view'); } // (once a game)
      bomber.flown = !!player.station?.flies && mode === 'crew'; // (pilots dead: you at the controls keep her up)
      const [rows, key] = controlsFor(player);
      ui.controls(rows, key);
      ui.gun(weapons.status(player));
      ui.crew(crew.members);
      ui.engines(bomber, !!player.station?.flies);
      ui.you(player.dead ? 0 : player.health, player.wounds);
      ui.health(bomber.health, bomber.bottles, bomber);
      ui.flight(flightHud());
      tags.update(camera, fighters.list, { side: 'allied', lead: !!weapons.current(player) && !mission.atSight });
    });
  }
  ui.tick(rawDt);
  if ((miniT -= rawDt) <= 0) { // the mini map, ten times a second
    miniT = 0.1;
    const on = state === 'playing' && !eject.active && (mode === 'crew' ? !player.away : !!pilot.f);
    ui.minimap(on ? { at: camera.getWorldPosition(_miniAt), yaw: Math.atan2(-camera.getWorldDirection(_miniDir).x, -_miniDir.z), bombers, fighters: fighters.list, target: mission.target.center, range: 3000, flak: flak.on ? flak.heavy : 0 } : null);
  }
  safely('figures', syncFigures); // the crew's poses onto their skeletons
  safely('scars', flushScars); // the holes from the latest hits, a few a frame
  if (gfx.ssao) gfx.ssao.enabled = !(mode === 'crew' && player.station?.id === 'ball' && player.blend > 0.5); // (in the ball you see out only through its window: no shading from what's behind its steel)
  // (the formation inspection's framing views: the camera taken out to look at the force, then put back)
  const dbg = formationDebug && (formationDebug.update(dt), formationDebug.frame());
  if (dbg) {
    const parent = camera.parent, p = camera.position.clone(), q = camera.quaternion.clone();
    scene.add(camera); camera.position.copy(dbg.at); camera.lookAt(dbg.look); camera.updateMatrixWorld();
    safely('render', () => gfx.render());
    parent.add(camera); camera.position.copy(p); camera.quaternion.copy(q); camera.updateMatrixWorld();
  } else safely('render', () => gfx.render());
  const prof = window.__prof;
  if (prof) { const all = Object.values(prof.parts).reduce((a, b) => a + b, 0); prof.sum ??= {}; prof.frames = (prof.frames ?? 0) + 1; for (const k in prof.parts) prof.sum[k] = (prof.sum[k] ?? 0) + prof.parts[k]; if (all > 40) prof.slow.push([+(performance.now() / 1000).toFixed(1), Math.round(all), Object.entries(prof.parts).filter(([, v]) => v > 8).map(([k, v]) => `${k} ${Math.round(v)}`).join(' ')]); prof.parts = {}; }
});

// handy for testing from the browser console
Object.assign(window, { game: { THREE, PART, tally, formationDebug, crewInfo, walkSweep: () => walkSweep(player), scene, camera, player, bomber, bombers, get crew() { return crew; }, crews, gfx, world, weapons, fighters, effects, flak, mission, showSeatMap, takeSeat, audio, missionComplete, pilot, chooseRole, showRoleMenu, ui, radio, pilotStats, stats, eject, bailOut, addScar, breakup, get mode() { return mode; }, skip: (s) => { missionTime += s; mission.target.center.z += AIRSPEED * s; } } });
