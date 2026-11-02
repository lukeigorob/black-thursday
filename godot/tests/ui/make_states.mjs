// The stand-in game's numbers for the UI test, one file read by both sides: the Godot test (test_ui.gd) and
// the web harness (web/harness.html), so the same screens can be compared side by side. Run with node to
// remake states.json (deterministic: no randomness).
import { writeFileSync } from 'node:fs';
const ROLES = [['pilot', 'Pilot', 'Lt.', 'pilot'], ['copilot', 'Co-pilot', 'Lt.', 'copilot'], ['bombardier', 'Bombardier', 'Lt.', 'noseR'], ['navigator', 'Navigator', 'Lt.', 'cheekL'],
  ['engineer', 'Engineer', 'T/Sgt.', 'top'], ['radio', 'Radio operator', 'T/Sgt.', 'radio'], ['ball', 'Ball gunner', 'S/Sgt.', 'ball'], ['waistL', 'Left waist', 'S/Sgt.', 'waistL'],
  ['waistR', 'Right waist', 'S/Sgt.', 'waistR'], ['tail', 'Tail gunner', 'S/Sgt.', 'tail']].map(([id, title, rank, station]) => ({ id, title, rank, station }));
const SUR = ['Miller', 'Kowalski', 'Hart', 'Dunn', 'Ortega', 'Baker', 'Svoboda', 'Price', 'Lyle', 'Novak', 'Reyes', 'Murphy', 'Grant', 'Fisher', 'Adler', 'Quinn', 'Walsh'];
const GROUPS = ['305th Bomb Group', '306th Bomb Group', '92nd Bomb Group', '91st Bomb Group', '381st Bomb Group', '351st Bomb Group', '94th Bomb Group', '96th Bomb Group',
  '385th Bomb Group', '95th Bomb Group', '100th Bomb Group', '390th Bomb Group', '303rd Bomb Group', '379th Bomb Group', '384th Bomb Group', '388th Bomb Group'];
const SQ = ['lead', 'high', 'low'];
const bombers = [];
let n = 0;
for (let g = 0; g < GROUPS.length; g++) {
  const gx = ((g % 3) - 1) * 900, gz = Math.floor(g / 3) * 1500 - 3000, gy = ((g % 3) - 1) * 150;
  for (let i = 0; i < 18 + (g < 3 ? 1 : 0); i++) {
    const sq = Math.floor(i / 6), k = i % 6;
    const x = gx + (sq - 1) * 160 + ((k % 3) - 1) * 45, z = gz + sq * 60 + Math.floor(k / 3) * 50, y = gy + (sq - 1) * 45 + (k % 3) * 8;
    const h = (n * 37) % 100;
    const crew = ROLES.map((r, j) => ({ name: `${r.rank} ${SUR[(n + j * 7) % SUR.length]}`, role: r, state: (n * 3 + j) % 23 === 0 ? 'dead' : (n + j) % 17 === 0 ? 'wounded' : 'ok' }));
    bombers.push({ label: `${GROUPS[g]}, ${SQ[sq]} squadron`, squad: g * 3 + sq, base: [x, y, z], down: h < 6, gone: false, burning: h >= 6 && h < 9, deadEngines: h >= 9 && h < 20 ? 1 : 0,
      damaged: h >= 20 && h < 35, health: h < 6 ? 0 : 1 - (h % 50) / 100, crew });
    n++;
  }
}
const mine = 4; // where you were
bombers[mine].crew[7].state = 'player';
const life = { role: 'crew', kills: 2, bombers: 0, assists: 1, crits: 3, hits: 37, fired: 412, damage: 52, points: 325, time: 412 };
const mission = { role: 'crew', kills: 3, bombers: 0, assists: 2, crits: 5, hits: 81, fired: 1130, damage: 117, points: 525, time: 1288 };
const SEATS = [['pilot', 'Pilot'], ['copilot', 'Co-pilot'], ['noseL', 'Nose gun, left'], ['noseR', 'Nose gun, right'], ['bombsight', 'Bombsight'], ['cheekL', 'Left cheek gun'], ['cheekR', 'Right cheek gun'],
  ['top', 'Top turret'], ['radio', 'Radio room gun'], ['ball', 'Ball turret'], ['waistL', 'Left waist'], ['waistR', 'Right waist'], ['tail', 'Tail gun']];
const seats = SEATS.map(([id, name], i) => {
  const m = bombers[mine].crew.find((c) => c.role.station === (id === 'bombsight' ? 'noseR' : id));
  const here = id === 'waistL', out = id === 'ball';
  const state = here ? 'you' : out ? 'out' : !m ? 'free' : m.state === 'player' ? 'free' : m.state;
  const who = !m ? 'No one' : m.state === 'player' ? 'You' : m.name;
  const job = m && m.role.title.toLowerCase() !== name.toLowerCase() && m.state !== 'player' ? m.role.title : '';
  return { id, name, who, job: i === 1 ? `${job ? `${job} · ` : ''}wounded once` : job, state, here, can: !out && m?.state !== 'dead' };
});
const forces = { total: 291, healthy: 236, damaged: 35, down: 20, aborted: 4, men: { dead: 61, wounded: 38 } };
const fcounts = { axis: { total: 300, air: 46, down: 38, reserve: 140, fw: 12 }, allied: { total: 48, air: 22, down: 3, reserve: 0 } };
const route = []; // in from England, the turn round the target, home
for (let z = 60000; z >= 0; z -= 6000) route.push([0, z]);
for (let a = 0; a <= 8; a++) { const t = (a / 8) * Math.PI; route.push([-3500 + Math.cos(t) * 3500, -Math.sin(t) * 3500]); }
route.push([-7000, 20000], [-9000, 60000]);
const city = { size: 3200, rail: { z0: 300, z1: 520 }, oldTown: { x: -500, z: -400, r: 420 }, riverW: 90, factory: { x0: -260, z0: -180, x1: 320, z1: 160 } };
const out = {
  quality: 'high', env: { time: 'day', season: 'autumn', weather: 'clear' }, envLabel: 'Clear · Day · Autumn',
  loadingSteps: ['Fuelling', 'Arming', 'Crew aboard', 'Forming up'], loadingTotal: 20, loadingDone: 9, fact: 4,
  start: {
    kicker: 'Eighth Air Force · 14 October 1943', title: 'Black Thursday', sub: 'B-17 Flying Fortress', stamp: 'Restricted',
    text: 'Mission briefing: Schweinfurt, the ball-bearing works, deep in Germany. The Thunderbolts can only take you as far as the border; after that you are on your own. Fly with the stream, or against it.',
    facts: [['Target', 'Schweinfurt'], ['Altitude', '25,000 ft'], ['Force', '291 B-17s'], ['Escort', '48 P-47s (to the border)'], ['Opposition', '300 fighters'], ['Conditions', 'Clear · Day · Autumn']],
    hint: '<kbd>1</kbd>–<kbd>4</kbd> pick a role · <kbd>←</kbd> <kbd>→</kbd> move · <kbd>Enter</kbd> take it',
  },
  status: { phase: 'Over Germany', detail: 'The fighters are coming up in strength', toTarget: 754, role: 'crew', health: 0.72, engines: 3, crewFit: 9,
    crewMen: { alive: 8, wounded: 1, dead: 1 }, life, mission, lives: 2, forces },
  seats, life, mission,
  bombers, mine,
  debrief: { dropped: 1460, onTarget: 512, playerDropped: 12, playerOnTarget: 5, destroyed: 41, buildings: 160, saved: 6, savedByYou: 2, crewHome: 9,
    crewMen: { alive: 8, wounded: 1, dead: 1 }, men: { alive: 2302, wounded: 38, dead: 61 }, kills: { player: 3, crew: 41, escorts: 9, alliedLost: 3, axisLost: 38 },
    bombersLost: 20, bombers: 291, pilot: { bombers: 2, fighters: 1, deaths: 1, saved: 3 }, score: mission, lives: 2, forces: { b: forces, f: fcounts } },
  forces, fcounts,
  gun: { ammo: 74, max: 500, heat: 0.78, jammed: false, reloading: false, reloadLeft: 0, reloadTime: 6 },
  crewList: bombers[mine].crew.map((m, i) => ({ ...m, woundLeft: 23, task: i === 3 ? 'helping' : '', patched: i === 5 })),
  engines: [{ state: 'ok' }, { state: 'fire' }, { state: 'smoking' }, { state: 'ok' }],
  wounds: { head: 0, torso: 0.3, armL: 0.7, armR: 0, legL: 0.1, legR: 0 },
  flight: { mph: 158, feet: 24850, throttle: 0.82, heading: 98, bank: -4, offset: 34, behind: 31, power: { need: 0.9, lost: [{ n: 2, state: 'fire', feathered: false }] }, nose: { x: 0.52, y: 0.46 } },
  fighter: { kind: 'Bf 109 G-6', view: 'cockpit', speed: 142, alt: 23800, throttle: 0.9, health: 0.64, heat: 0.55, jammed: false,
    ammo: { mg: { n: 412, max: 600 }, cannon: { n: 120, max: 150 } }, marker: { x: 0.5, y: 0.48 }, aim: { x: 0.56, y: 0.42 }, reflector: false, damage: 'ENGINE HIT' },
  fighterParts: { k: { name: 'Bf 109 G-6', parts: { engine: { hp: 30 }, pilot: { hp: 10 }, fuel: { hp: 16 }, wingL: { hp: 40 }, wingR: { hp: 40 }, fuselage: { hp: 50 }, tail: { hp: 24 } } },
    kind: 'bf109', parts: { engine: 12, pilot: 10, fuel: 16, wingL: 18, wingR: 40, fuselage: 41, tail: 24 }, burning: false, smoking: true, alive: true },
  sight: { across: -42, along: 3400, phase: 'bombrun', released: false, bombs: 12 },
  identity: { ident: { type: 'B-17F', nickname: 'Ol\' Gappy', known: true, confidence: 'PROBABLE', serial: '42-30604', unit: '305th Bomb Group', squadron: '422nd', code: 'JJ-F',
    pilot: '1st Lt. Example Pilot', outcome: 'returned_damaged', slotDocumented: true, slotBasis: true, lossDetails: '' },
    crew: bombers[mine].crew.map((m, i) => ({ title: m.role.title, name: m.name, placeholder: i > 7, confidence: i < 4 ? 'VERIFIED' : 'UNVERIFIED', fate: i === 2 ? 'Wounded' : 'Returned' })) },
  controls: [['W A S D', 'walk'], ['E', 'take / leave a position'], ['Click', 'fire'], ['Right click', 'zoom'], ['R', 'reload'], ['C', 'hold: look round']],
  tip: ['On a gun', [['Click', 'fire'], ['Right click', 'zoom'], ['R', 'reload'], ['C', 'hold: look round'], ['E', 'leave the gun']]],
  prompt: '<b>E</b> Leave&nbsp;&nbsp;&nbsp;<b>1</b><b>2</b><b>3</b><b>4</b> guns, left to right <span class="dim"><b>5</b> bombsight from the initial point</span>',
  minimap: { range: 3000, flak: 0.4, yaw: 0.3 },
  missionMap: { phase: 'Over Germany', toTarget: 754, wrecked: 41, buildings: 160, route, flak: [6000, -2000], start: 60000, ip: 14000, rally: [-3500, -3500], home: [-9000, 60000], city,
    self: [0, 9000] },
  events: ['Rally turn: the formation banks right for home', 'Bandits, twelve o\'clock high!', 'Navigator to crew: the I.P. in two minutes', 'You are now left waist S/Sgt. Price, 305th Bomb Group, lead squadron.'],
};
writeFileSync(new URL('./states.json', import.meta.url), JSON.stringify(out));
console.log('states.json', bombers.length, 'bombers');
