// The web half of the UI comparison: the game's own UI class, fed the stand-in numbers in ../states.json, one
// screen per #hash (the same names as the Godot test's shots). Nothing here is the game: just enough of main.js's
// calls to put each screen up.
import { UI } from '/src/ui.js';

const html = await (await fetch('/index.html')).text();
document.getElementById('game-style').textContent = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
const S = await (await fetch('../states.json')).json();
// the battle behind: a still on the page's canvas (what ui.hurt blurs)
const cv = document.getElementById('scene-canvas');
Object.assign(cv.style, { display: 'block', position: 'fixed', inset: '0', width: '100%', height: '100%' });
cv.width = innerWidth; cv.height = innerHeight;
const img = new Image();
img.src = '/loading/formation.jpg';
await img.decode();
{ const g = cv.getContext('2d'), k = Math.max(cv.width / img.width, cv.height / img.height); g.drawImage(img, (cv.width - img.width * k) / 2, (cv.height - img.height * k) / 2, img.width * k, img.height * k); }
document.getElementById('scene').remove();

const vec = ([x, y, z]) => ({ x, y, z, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); } });
const bombers = S.bombers.map((b) => ({ ...b, base: vec(b.base), group: { position: vec(b.base) } }));
const crews = new Map(bombers.map((b, i) => [b, { members: S.bombers[i].crew }]));
const mine = bombers[S.mine];
const noop = () => {};
const ui = new UI();
ui.fullscreen();
ui.sound(noop);
ui.hudOptions(noop);
const env = { ...S.env };
ui.envControls(env, noop);
ui.conditions('default', env, noop, noop);
for (const e of S.events) ui.log(e);
const chooseRole = noop;

const start = () => ui.menu({ kind: 'start', ...S.start, roles: chooseRole, quality: S.quality, onQuality: noop });
const pause = () => ui.menu({ kind: 'pause', kicker: 'Crew, stand by', title: 'Paused', stamp: 'Hold', status: S.status, button: 'Resume', onClick: noop, quality: S.quality, onQuality: noop,
  seats: S.seats, onSeat: noop,
  actions: [{ label: 'Change aircraft', onClick: noop }, { label: 'Controls', onClick: noop }, { label: 'Options', onClick: noop }, { label: 'Settings', onClick: noop },
    { label: 'Quit to menu', confirm: 'Click again to quit', onClick: noop }],
  hint: 'Quitting starts the mission again from the briefing' });
const bomberHud = { engines: S.engines, tankFire: { '-1': 0, 1: 0 }, down: false, damage: (n) => ({ wingLo: 0.15, engine2: 0.6, waist: 0.4, tail: 0.85, nose: 0.05, radio: 0.3 })[n] ?? 0, lost: {}, secFire: {}, deadEngines: 0 };
const crewHud = () => {
  ui.setMode('crew'); ui.play();
  ui.mission('Over Germany · target in 12:34');
  ui.forces(S.forces, S.fcounts);
  ui.hud({ location: 'Left waist', prompt: S.prompt, atStation: true });
  ui.controls(S.controls, 'gun');
  ui.gun(S.gun);
  ui.crew(S.crewList);
  ui.engines(bomberHud, true);
  ui.you(0.62, S.wounds);
  ui.health(0.72, 2, bomberHud);
  ui.lifeStats(S.life);
  ui.kill(2);
  ui.minimap({ at: mine.base, yaw: S.minimap.yaw, bombers, fighters: [{ alive: true, pos: vec([mine.base.x + 600, 0, mine.base.z - 900]), side: 'axis' }, { alive: true, pos: vec([mine.base.x - 900, 0, mine.base.z + 400]), side: 'allied' }],
    target: vec([0, 0, -9000]), range: S.minimap.range, flak: S.minimap.flak });
  ui.tick(0.5); ui.tick(0.5);
};
const STATES = {
  loading: () => {
    const l = ui.loading(S.loadingSteps, S.loadingTotal, S.quality, noop);
    for (let i = 0; i < S.loadingDone; i++) l.tick(i < 6 ? 0 : 1);
  },
  start,
  start_settings: () => { start(); ui.drawer('settings'); },
  start_options: () => { start(); ui.drawer('options'); },
  start_controls: () => { start(); ui.drawer('controls'); },
  roles: () => ui.menu({ kind: 'roles', kicker: 'Sortie over', title: 'You were shot down', text: 'Fly again, or take another role.', body: ui.lifeCard(S.life), roles: chooseRole,
    quality: S.quality, onQuality: noop, hint: '<kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> pick a role' }),
  pause,
  pause_quit: () => { pause(); document.querySelector('#menu-extra button:last-child').click(); },
  map: () => ui.map({ title: 'You were killed', text: 'Pick any surviving bomber on the map, then the crewman you will carry on as. Double-click a bomber to board her straight away.',
    record: ui.lifeCard(S.life, 'That life'), bombers, crewOf: (b) => crews.get(b), mine, onPick: noop, onRole: chooseRole }),
  debrief: () => ui.debrief(S.debrief, noop, noop, 'crew'),
  debrief_pilot: () => ui.debrief(S.debrief, noop, noop, 'bf109'),
  over: () => ui.menu({ kind: 'over', kicker: 'Mission failed', title: 'The bombers are all gone', stamp: 'Lost', text: 'Fighters shot down: 41.', body: ui.lifeCard(S.mission, 'Whole mission'),
    button: 'Fly again', onClick: noop, quality: S.quality, onQuality: noop }),
  hud_crew: crewHud,
  hud_events: () => {
    crewHud();
    ui.toast('Bail out! Get to a hatch!', 'kill'); ui.toast('Back in formation');
    ui.banner('kill', 'Bf 109 G-6', 100); ui.banner('assist', 'Fw 190 A-6', 50);
    ui.tip('gun', ...S.tip);
    ui.hint('Click to capture the mouse.');
  },
  hud_seat: () => {
    crewHud();
    ui.hud({ location: 'Pilot', prompt: '<b>T</b> Extinguish fire (engine 2) · 2 bottles left&nbsp;&nbsp;&nbsp;<b>F</b> Feather engine 2', atStation: true });
    ui.gun(null);
    ui.flight(S.flight);
  },
  hud_fighter: () => {
    ui.setMode('bf109'); ui.play();
    ui.mission('Over Germany · target in 12:34');
    ui.forces(S.forces, S.fcounts);
    ui.hud({ location: 'Bf 109 G-6 · cockpit', prompt: '', atStation: true });
    ui.fighter(S.fighter);
    ui.fighterDamage(S.fighterParts);
    ui.lifeStats(S.life);
    ui.lock([1150, 470], 412);
  },
  hud_sight: () => { crewHud(); ui.gun(null); ui.hud({ location: 'Bombsight', prompt: '', atStation: true }); ui.sight(S.sight); },
  hud_eject: () => { ui.setMode('eject'); ui.play(); ui.hud({ location: 'Free fall', prompt: '<span style="font-size:24px">Press <b>J</b> to pull your parachute</span>', atStation: false }); ui.ejected(ui.lifeCard(S.life, 'That life'), false); },
  mission_map: () => { crewHud(); ui.missionMap({ ...S.missionMap, city: { ...S.missionMap.city, riverZ: (x) => 400 + 120 * Math.sin(x / 400) }, bombers: S.bombers.filter((b) => !b.down).map((b) => [b.base[0] * 0.5, b.base[2] * 0.5 + 9000]),
    fighters: [{ side: 'axis', at: [400, 8000] }, { side: 'allied', at: [-300, 9600] }] }); },
  identity: () => { crewHud(); ui.identity(S.identity); },
  hurt: () => { crewHud(); ui.hurt(14, 30, false); },
};
const name = location.hash.slice(1) || 'start';
STATES[name]();
document.title = `ready ${name}`;
