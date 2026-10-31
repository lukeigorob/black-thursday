// Menus (start / pause with the graphics setting) and the HUD (crosshair, prompts, location, fps).
import { QUALITY } from './graphics.js';
import { ENV_OPTIONS, envLabel } from './environment.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- the damage diagram ----------
const K = 5.6, X = (x) => (100 + x * K).toFixed(1), Y = (z) => (70 + z * K).toFixed(1);
const poly = (part, pts, extra = '') => `<polygon data-part="${part}" points="${pts.map(([x, z]) => `${X(x)},${Y(z)}`).join(' ')}" ${extra}/>`;
const le = (x) => -7.3 + ((Math.abs(x) - 1.25) / 15) * 2.2, te = (x) => -1.3 - ((Math.abs(x) - 1.25) / 15) * 2.4; // wing leading / trailing edges
const wing = (part, x0, x1) => poly(part, [[x0, le(x0)], [x1, le(x1)], [x1, te(x1)], [x0, te(x0)]]);
const section = (part, z0, z1, w0, w1) => poly(part, [[-w0, z0], [w0, z0], [w1, z1], [-w1, z1]]);
const DIAGRAM = `<g class="dmg-body">
  ${wing('wingLo', -16.3, -8)}${wing('wingLi', -8, -1.2)}${wing('wingRi', 1.2, 8)}${wing('wingRo', 8, 16.3)}
  ${poly('tailplane', [[-6.5, 9.2], [-6.2, 8.1], [-1, 7.1], [1, 7.1], [6.2, 8.1], [6.5, 9.2], [1, 10.1], [-1, 10.1]])}
  ${section('nose', -11.4, -8.6, 0.35, 1.0)}${section('cockpit', -8.6, -6.35, 1.0, 1.25)}${section('bombbay', -6.35, -2.6, 1.25, 1.3)}
  ${section('radio', -2.6, -1.25, 1.3, 1.25)}${section('waist', -1.25, 5.2, 1.25, 0.95)}${section('tail', 5.2, 11.4, 0.95, 0.3)}
  ${[-7.16, -3.93, 3.94, 7.15].map((x, i) => `<rect data-part="engine${i + 1}" x="${X(x - 0.6)}" y="${Y(-9.2)}" width="${(1.2 * K).toFixed(1)}" height="${(3.6 * K).toFixed(1)}" rx="2"/>`).join('')}
  <circle data-part="top" cx="${X(0)}" cy="${Y(-6.7)}" r="${(0.6 * K).toFixed(1)}"/>
  <circle data-part="ball" cx="${X(0)}" cy="${Y(-0.1)}" r="${(0.55 * K).toFixed(1)}" stroke-dasharray="2 1.5"/>
</g>`;
const STOPS = [[0, [143, 165, 138]], [0.25, [240, 170, 160]], [0.55, [205, 60, 45]], [0.8, [95, 18, 14]], [1, [12, 10, 10]]];
/** normal -> light red -> dark red -> black */
function damageColour(d) {
  d = Math.min(1, Math.max(0, d));
  let i = 0;
  while (i < STOPS.length - 2 && d > STOPS[i + 1][0]) i++;
  const [a, ca] = STOPS[i], [b, cb] = STOPS[i + 1], t = (d - a) / (b - a);
  return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * t)).join(',')})`;
}
const DMG_PARTS = ['wingLo', 'wingLi', 'wingRi', 'wingRo', 'tailplane', 'nose', 'cockpit', 'bombbay', 'radio', 'waist', 'tail', 'engine1', 'engine2', 'engine3', 'engine4', 'top', 'ball'];
const damageKey = (b) => DMG_PARTS.map((n) => Math.round(b.damage(n) * 40)).join() + b.engines.map((e) => e.state).join() + Object.values(b.secFire ?? {}).map(Boolean).join() + b.tankFire[-1] + b.tankFire[1];

// ---------- the menus' artwork: insignia and plan-view silhouettes, drawn as SVG ----------
const star = (r) => Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? r * 0.382 : r;
  return `${(Math.cos(a) * k).toFixed(1)},${(Math.sin(a) * k).toFixed(1)}`;
}).join(' ');
// the loading screen's backgrounds (public/loading): stills of the battle, captured in the game
const LOADING_SHOTS = ['flak', 'going-down', 'formation', 'night-flak', 'fighter', 'stream'];

const EMBLEM = {
  crew: () => `<svg class="emblem" viewBox="-60 -30 120 60" aria-hidden="true"><rect x="-56" y="-9" width="112" height="18" fill="#f3efe4" stroke="#22406e" stroke-width="3.5"/>
    <circle r="27" fill="#22406e"/><polygon points="${star(25)}" fill="#f3efe4"/></svg>`,
  bf109: () => `<svg class="emblem" viewBox="-30 -30 60 60" aria-hidden="true"><path d="M-11-27h22v16h16v22h-16v16h-22v-16h-16v-22h16z" fill="#f3efe4" stroke="#111" stroke-width="1"/>
    <path d="M-5-27h10v22h22v10h-22v22h-10v-22h-22v-10h22z" fill="#111"/></svg>`,
  fw190: () => `<svg class="emblem" viewBox="-30 -30 60 60" aria-hidden="true"><circle r="28" fill="#e8b400"/><circle r="28" fill="none" stroke="#111" stroke-width="2"/>
    <path d="M-10-24h20v14h14v20h-14v14h-20v-14h-14v-20h14z" fill="#f3efe4" stroke="#111" stroke-width="1"/><path d="M-4.5-24h9v19.5h19.5v9h-19.5v19.5h-9v-19.5h-19.5v-9h19.5z" fill="#111"/></svg>`, // (on the yellow of the Reich defence)
  p47: () => EMBLEM.crew(), // the USAAF's star and bars, as on the Thunderbolt's wings and fuselage
};
const both = (d) => `<path d="${d}"/><path d="${d}" transform="matrix(-1 0 0 1 100 0)"/>`; // a wing and its mirror
const PLAN = { // recognition-chart plan views, nose up
  crew: `<svg class="plan" viewBox="0 0 200 140" aria-hidden="true">${DIAGRAM}</svg>`,
  bf109: `<svg class="plan" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 9C53.5 9 55 14 55.5 22L55 60 52.5 88h-5L45 60 44.5 22C45 14 46.5 9 50 9z"/>
    ${both('M45 33 8 37.5Q5 38 5 40.5l.5 3Q6 45.5 9 45.5L45 50z')}${both('M47.5 79 36 81Q34 82 34.5 84l1.5 2.5 11.5.5z')}</svg>`,
  fw190: `<svg class="plan" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 7C55.5 7 57 12 57 20L55.5 60 52.5 90h-5L44.5 60 43 20C43 12 44.5 7 50 7z"/>
    ${both('M44 30 7 37Q4 38 4 41q0 3.5 3.5 4L44 49z')}${both('M47.5 82 34 83.5Q32 84.5 32.5 87q.5 2 2.5 2h12.5z')}</svg>`,
  p47: `<svg class="plan" viewBox="0 0 100 100" aria-hidden="true"><path d="M50 10C53 10 54.5 15 55 24v34l-3 28h-4l-3-28V24C45.5 15 47 10 50 10z"/>
    ${both('M45 36 9 40.5Q5 41 5 44q0 3.5 3.5 3.5L45 52z')}${both('M48 78 37 80Q35 81 35.5 83.5 36 85.5 38 85.5h10z')}</svg>`,
};
// the fighters' own damage diagrams, from the same plan views: [fuselage, left wing, tailplane (one
// half, mirrored), engine y0..y1 and half-width, cockpit y, fuel tank y0..y1] in a 100 x 100 box, nose up
const FPLAN = {
  bf109: ['M50 9C53.5 9 55 14 55.5 22L55 60 52.5 88h-5L45 60 44.5 22C45 14 46.5 9 50 9z', 'M45 33 8 37.5Q5 38 5 40.5l.5 3Q6 45.5 9 45.5L45 50z', 'M47.5 79 36 81Q34 82 34.5 84l1.5 2.5 11.5.5z', 9.5, 25, 4.6, 37, 45, 53],
  fw190: ['M50 7C55.5 7 57 12 57 20L55.5 60 52.5 90h-5L44.5 60 43 20C43 12 44.5 7 50 7z', 'M44 30 7 37Q4 38 4 41q0 3.5 3.5 4L44 49z', 'M47.5 82 34 83.5Q32 84.5 32.5 87q.5 2 2.5 2h12.5z', 8, 24, 6, 35, 41, 49],
  p47: ['M50 10C53 10 54.5 15 55 24v34l-3 28h-4l-3-28V24C45.5 15 47 10 50 10z', 'M45 36 9 40.5Q5 41 5 44q0 3.5 3.5 3.5L45 52z', 'M48 78 37 80Q35 81 35.5 83.5 36 85.5 38 85.5h10z', 10.5, 31, 4.6, 41, 49, 56],
};
const FDIAGRAM = Object.fromEntries(Object.entries(FPLAN).map(([kind, [body, wing, tail, e0, e1, ew, cy, f0, f1]]) => [kind, `<g class="dmg-body">
  <path data-part="wingL" d="${wing}"/><path data-part="wingR" d="${wing}" transform="matrix(-1 0 0 1 100 0)"/>
  <path data-part="tail" d="${tail}"/><path data-part="tail" d="${tail}" transform="matrix(-1 0 0 1 100 0)"/>
  <path data-part="fuselage" d="${body}"/>
  <rect data-part="engine" x="${50 - ew}" y="${e0}" width="${ew * 2}" height="${e1 - e0}" rx="2.5"/>
  <rect data-part="fuel" x="46.5" y="${f0}" width="7" height="${f1 - f0}" rx="1"/>
  <circle data-part="pilot" cx="50" cy="${cy}" r="3.2"/></g>`]));

const ROLES = {
  crew: { name: 'B-17 crewman', unit: 'Eighth Air Force', line: 'Ten men, thirteen guns, one target.',
    does: ['Man any of the bomber\'s guns', 'Fly her from the pilot\'s seat', 'Drop the bombs through the Norden sight', 'Patch up the wounded'] },
  bf109: { name: 'Bf 109 pilot', unit: 'Luftwaffe · JG 26', line: 'Break up the bomber stream.',
    does: ['Dive through the boxes head-on', 'Bring the B-17s down', 'Wait for the Thunderbolts to turn back'] },
  fw190: { name: 'Fw 190 pilot', unit: 'Luftwaffe · Sturmgruppe', line: 'Through the bombers head-on.',
    does: ['Four 20 mm cannon and armour', 'Attack in a tight group from ahead', 'Outrun the escorts in a dive'] },
  p47: { name: 'P-47 pilot', unit: '56th Fighter Group', line: 'Cover the bombers as far as your fuel goes.',
    does: ['Fly escort over the stream', 'Break up attacks before they land', 'Turn back when your fuel runs low'] },
};
const ICON = {
  full: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/><circle cx="12" cy="12" r="6.5"/></svg>',
  keys: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h1M9.5 10h1M13 10h1M16.5 10h1M7 14h10"/></svg>',
  info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/></svg>',
  muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
};
const CONTROLS = [
  ['General', [['Esc', 'pause'], ['M', 'mission map (hold)'], ['H', 'controls card'], ['N', 'mute'], ['F3', 'frame rate'], ['J', 'bail out (B-17: rings the bell, then E at a red hatch) · in free fall: the ripcord'], ['Alt+Enter', 'full screen']]],
  ['B-17 crewman', [['W A S D', 'walk'], ['Shift', 'hurry'], ['Mouse', 'look'], ['E', 'take / leave a position'], ['Left click', 'fire'], ['Right click', 'zoom'], ['R', 'reload'],
    ['C', 'hold: look round'], ['F', 'hold by a wounded man: first aid']]],
  ['Pilot\'s seat', [['Mouse', 'steer'], ['W / S', 'throttle'], ['A / D', 'roll'], ['T', 'fire bottle, worst engine'], ['F', 'feather it'], ['1 – 4', 'a bottle on that engine'], ['C', 'hold: look round'], ['V', 'cockpit / third-person view']]],
  ['Bombsight', [['1 – 4', 'in the nose: its guns, left to right'], ['5 / B', 'in the nose, from the initial point: the bombsight'], ['A / D', 'steer the formation'], ['Space / Click', 'bombs away'], ['B / E', 'leave the sight']]],
  ['Fighters', [['Mouse', 'aim where you fly'], ['W / S', 'throttle'], ['A / D', 'roll'], ['Left click', 'guns'], ['C', 'hold: look round'], ['V', 'cockpit / third-person view'], ['J', 'bail out']]],
];
/** "W / S" -> <kbd>W</kbd> <kbd>S</kbd>; "W A S D" -> four keys. */
const keycaps = (k) => k.split(' / ').flatMap((x) => (/^([A-Z] )+[A-Z]$/.test(x) ? x.split(' ') : [x])).map((x) => `<kbd>${x}</kbd>`).join(' ');
const FACTS = [
  'The B-17F carried up to twelve .50-calibre machine guns, two of them in the nose cheeks.',
  'Bomber crews flew at 25,000 feet in an unpressurised cabin, at forty below and colder.',
  'Gunners wore electrically heated suits, plugged into the aircraft.',
  'The Norden bombsight was so secret that bombardiers swore an oath to protect it.',
  'The combat box stacked the bombers so that their guns covered one another.',
  'A tour of duty was 25 missions. In the autumn of 1943 few crews lived to finish one.',
  'More than 12,000 B-17s were built between 1936 and 1945.',
  'In October 1943 the P-47s could only escort the bombers as far as the German border.',
  'On 14 October 1943, Black Thursday, 60 of the 291 B-17s sent to Schweinfurt were shot down.',
  'The ball turret gunner flew curled up under the fuselage, with no room for his parachute.',
];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** A little paper texture for the formation plot: flecks and fibres on cream. */
function paperTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e9dfc3'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.55 ? '90,70,40' : '255,250,235'},${(Math.random() * 0.08).toFixed(3)})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  return c;
}

export class UI {
  constructor() {
    const root = document.getElementById('ui');
    root.innerHTML = `
      <div id="menu" class="menu" data-kind="loading">
        <div class="m-slides" aria-hidden="true"></div>
        <div class="m-frame">
          <header class="m-top">
            <div class="m-brand">${EMBLEM.crew()}<span>Eighth Air Force</span><i></i><span>VIII Bomber Command</span></div>
            <nav class="m-tools"><div class="tool snd-top" title="Sound (N mutes)"><button id="snd-mute-top" class="icon-btn" aria-label="Mute"></button>
                <input id="snd-vol-top" type="range" min="0" max="100" step="1" value="100" aria-label="Volume"><output id="snd-val-top"></output></div>
              <button class="tool" data-fs title="Full screen (Alt+Enter)">${ICON.full}<span>Full screen</span></button>
              <button class="tool" data-open="controls">${ICON.keys}<span>Controls</span></button>
              <button class="tool" data-open="settings">${ICON.gear}<span>Settings</span></button></nav>
          </header>
          <main class="m-main"><div class="m-card" id="menu-card">
            <div class="stamp" id="menu-stamp"></div>
            <div class="m-kicker" id="menu-kicker"></div>
            <h1 id="menu-title"></h1>
            <div class="m-sub" id="menu-sub"></div>
            <p class="m-brief" id="menu-text"></p>
            <div class="m-facts" id="menu-facts"></div>
            <div class="conditions" id="menu-cond"><span class="lbl">Mission conditions</span>
              <div class="seg" role="radiogroup">${[['default', 'Default'], ['choose', 'Choose'], ['random', 'Random']].map(([v, l]) => `<button data-mode="${v}" role="radio">${l}</button>`).join('')}</div>
              <div class="cond-pick">${Object.entries(ENV_OPTIONS).map(([k, opts]) => `<div class="select small"><select data-cond="${k}" aria-label="${k}">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>`).join('')}</div>
              <span class="cond-note"></span></div>
            <div class="m-loading" id="menu-loading"></div>
            <div class="m-status" id="menu-status"></div>
            <div class="m-body" id="menu-body"></div>
            <div id="menu-roles" class="roles"></div>
            <div class="m-actions"><button id="menu-go" class="btn primary"></button><div class="m-extra" id="menu-extra"></div></div>
          </div></main>
          <footer class="m-foot">
            <p class="m-hint" id="menu-hint"></p>
          </footer>
        </div>
        <div class="scrim" id="drawer-scrim"></div>
        <aside class="drawer" id="drawer">
          <div class="drawer-head"><div class="tabs" role="tablist"><button class="tab" data-tab="settings" role="tab">Settings</button><button class="tab" data-tab="options" role="tab">Options</button><button class="tab" data-tab="controls" role="tab">Controls</button></div>
            <button class="tool close" id="drawer-close" aria-label="Close">Close <kbd>Esc</kbd></button></div>
          <section class="pane" data-pane="settings">
            <div class="set-row"><label>Display</label><p>Alt+Enter switches it in the game too.</p>
              <button class="btn ghost" data-fs style="padding:9px 18px;font-size:15px">Full screen</button></div>
            <div class="set-row"><label for="menu-quality">Graphics</label><p>Lower it if the frame rate drops.</p>
              <div class="select"><select id="menu-quality">${Object.entries(QUALITY).map(([k, q]) => `<option value="${k}">${q.label}</option>`).join('')}</select></div></div>
            <div class="set-row"><label for="snd-vol">Sound</label><p>N mutes it in the game too.</p>
              <div class="sound"><button id="snd-mute" class="icon-btn" title="Mute (N)" aria-label="Mute"></button>
                <input id="snd-vol" type="range" min="0" max="100" step="1" value="100" aria-label="Volume"><output id="snd-val"></output></div></div>
            <div class="set-row"><label>Sound mix</label><p>Each kind of sound on its own.</p>
              <div class="mix">${[['guns', 'Guns'], ['engines', 'Engines'], ['battle', 'Flak and hits'], ['crew', 'Crew and turret motors'], ['ui', 'Menu sounds']].map(([k, l]) => `<label class="sound"><span>${l}</span>
                <input type="range" min="0" max="100" step="1" value="100" data-mix="${k}" aria-label="${l}"><output data-mix-val="${k}"></output></label>`).join('')}</div></div>
            ${[['time', 'Time of day', 'Morning sun, high noon, dusk or a moonlit night.'], ['season', 'Season', 'Autumn browns the fields (mid-October, as on the day); winter brings snow and thicker contrails.'],
    ['weather', 'Weather', 'Clear, cloudy, rain, or a thunderstorm with lightning.']].map(([k, name, help]) => `<div class="set-row"><label for="env-${k}">${name}</label><p>${help}</p>
              <div class="select"><select id="env-${k}" data-env="${k}">${ENV_OPTIONS[k].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div></div>`).join('')}
          </section>
          <section class="pane" data-pane="options">
            <p class="pane-note">What's drawn over the battle. Each one on its own; remembered for next time.</p>
            ${[['enemy', 'Enemy markers', 'The red triangles over enemy aircraft'], ['friend', 'Friendly markers', 'The blue triangles over your own side'],
    ['distance', 'Distance numbers', 'The range under each marker, once within 1,000 m'], ['lead', 'Lead marker', 'Where to aim ahead of a fighter so your rounds meet it'],
    ['plainSight', 'Plain crosshair in fighters', 'Instead of the reflector gunsight in the cockpit'], ['third', 'Third-person view for pilots', 'Behind your fighter or your B-17 instead of the cockpit. V switches it in flight'], ['infinite', 'Infinite ammunition', 'Your guns never run out (off: limited, as the real ones were: reload with R)'],
    ['historical', 'Historical outcomes', 'The bombers recorded as lost on 14 October 1943 are the likeliest to go down, those that came home the least, and the recorded aborts turn back. Off: the battle plays out on its own']]
    .map(([k, name, help]) => `<label class="set-row toggle"><span><b>${name}</b><small>${help}</small></span><input type="checkbox" data-hud="${k}"${k === 'lead' ? ' checked' : ''}><i></i></label>`).join('')}
          </section>
          <section class="pane" data-pane="controls"><div class="ctl-groups">${CONTROLS.map(([name, rows]) => `<div class="ctl-group"><h4>${name}</h4>
            ${rows.map(([k, what]) => `<div><span>${keycaps(k)}</span><span>${what}</span></div>`).join('')}</div>`).join('')}</div></section>
        </aside>
      </div>
      <div id="map" class="menu">
        <div class="m-frame seat">
          <header class="m-top"><div class="m-brand">${EMBLEM.crew()}<span>Eighth Air Force</span><i></i><span>Formation plot</span></div>
            <div class="m-top-note">The battle holds while you choose</div></header>
          <div class="seat-head"><button class="btn ghost map-back" id="map-back">← Back <kbd>Esc</kbd></button><div class="m-kicker">Pick your seat</div><h1 id="map-title"></h1><p id="map-text"></p></div>
          <div class="seat-grid">
            <aside class="seat-left"><div id="map-record"></div>
              <div class="how"><div><span>Pan</span><span>drag the map</span></div><div><span>Zoom</span><span>mouse wheel · <kbd>+</kbd> <kbd>−</kbd></span></div>
                <div><span>Whole formation</span><span><kbd>0</kbd> or Fit all</span></div><div><span>Pick</span><span>click a bomber, then a man</span></div></div></aside>
            <div class="map-wrap" id="map-wrap"><canvas id="map-canvas"></canvas>
              <div class="map-tools"><button class="z" data-z="in" title="Zoom in (+)">+</button><button class="z" data-z="out" title="Zoom out (−)">−</button>
                <button data-z="fit" title="The whole formation (0)">Fit all</button><button data-z="me" title="Back to where you were">Where I was</button></div>
              <div class="map-legend"><span><i style="background:var(--fit)"></i>Fit</span><span><i style="background:var(--dmg)"></i>Damaged</span>
                <span><i style="background:var(--fire)"></i>Burning</span><span><i style="background:#8a8273"></i>No one left</span><span><i class="ring"></i>Where you were</span><span>Paler = lower in the stack</span></div>
              <div class="map-tip" id="map-tip"></div></div>
            <aside class="seat-right"><div id="map-side" class="roster"></div>
              <div class="fly-fighter"><div class="lbl">Or fly a fighter</div><div id="map-roles" class="roles small"></div></div></aside>
          </div>
        </div>
      </div>
      <div id="hud">
        <div id="crosshair"></div>
        <div id="location"></div>
        <div id="prompt"></div>
        <div id="speedwarn"></div>
        <div id="controls"></div>
        <div id="fps"></div>
        <div id="hint"></div>
        <div id="tip"></div>
        <div id="lock"><span>LOCKED</span></div>
        <div id="hitmarker"><i></i><i></i><i></i><i></i></div>
        <div id="mission"></div>
        <div id="forces"></div>
        <div id="sight"><div class="ring"></div><div class="h"></div><div class="v"></div>
          <div id="sight-info"></div></div>
        <div id="crew"></div>
        <div id="you"><svg id="you-body" viewBox="0 0 40 80" aria-hidden="true"><circle data-z="head" cx="20" cy="8" r="6.5"/><rect data-z="torso" x="12" y="16" width="16" height="26" rx="3"/><rect data-z="armL" x="5" y="17" width="6" height="25" rx="3"/><rect data-z="armR" x="29" y="17" width="6" height="25" rx="3"/><rect data-z="legL" x="12.5" y="43" width="7" height="34" rx="3"/><rect data-z="legR" x="20.5" y="43" width="7" height="34" rx="3"/></svg><div class="you-col"><div class="you-row"><span class="lbl">You</span><span class="bar"><i id="you-bar"></i></span><b id="you-pct"></b></div><span id="you-zone"></span></div></div>
        <div id="hitflash"></div>
        <div id="ident"></div>
        <div id="health"><svg id="dmg" viewBox="0 0 200 140"></svg><span id="health-pct"></span></div>
        <div id="engines"></div>
        <div id="nose"></div>
        <div id="gunsight"><i></i></div>
        <div id="flight"></div>
        <div id="aid"><div class="bar"><i id="aid-bar"></i></div></div>
        <div id="hurt"><div id="hurt-text"></div></div>
        <div id="kills"></div>
        <div id="lifestats"></div>
        <div id="banners"></div>
        <div id="ejectcard"></div>
        <div id="toasts"></div>
        <div id="mmap"><canvas id="mmap-canvas" width="720" height="720"></canvas><div id="mmap-side"></div></div>
        <div id="minimap"><canvas id="minimap-canvas" width="400" height="400"></canvas></div>
        <div id="gun">
          <div id="gun-ammo"></div>
          <div class="bar"><i id="gun-heat"></i></div><span class="lbl">Barrel heat</span>
          <div id="gun-state"></div>
          <div class="bar reload"><i id="gun-reload"></i></div>
        </div>
      </div>`;
    this.el = (id) => document.getElementById(id);
    this.showFps = false;
    this.frames = 0;
    this.fpsTime = 0;
    // the menus' drawer (settings and controls), and the keys that work on a menu
    for (const b of root.querySelectorAll('[data-open]')) b.onclick = () => this.drawer(b.dataset.open);
    for (const b of root.querySelectorAll('.tab')) b.onclick = () => this.drawer(b.dataset.tab);
    this.el('drawer-close').onclick = this.el('drawer-scrim').onclick = () => this.closeDrawer();
    addEventListener('keydown', (e) => this.menuKey(e));
    addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); this.showFps = !this.showFps; this.el('fps').style.display = this.showFps ? 'block' : 'none'; }
    });
  }

  /**
   * Role cards: crew / bf109 / fw190 / p47. `into` is the element id; onRole(id) is called with the choice.
   * only: the ids to offer (all three by default). 1, 2, 3 pick them from the keyboard too.
   */
  roles(into, onRole, only = ['crew', 'bf109', 'fw190', 'p47']) {
    const box = this.el(into);
    if (!onRole) { box.innerHTML = ''; return; }
    box.innerHTML = only.map((id, i) => {
      const r = ROLES[id];
      return `<button class="role-card ${id}" data-role="${id}"><span class="stripe"></span>${PLAN[id]}
        <header>${EMBLEM[id]()}<span class="unit">${r.unit}</span></header>
        <h2>${r.name}</h2><p class="line">${r.line}</p>
        <ul>${r.does.map((d) => `<li>${d}</li>`).join('')}</ul>
        <footer><span><kbd>${i + 1}</kbd></span><span class="go">Take this role &rarr;</span></footer></button>`;
    }).join('');
    for (const b of box.querySelectorAll('button')) b.onclick = () => onRole(b.dataset.role);
  }

  /** Open the menu's drawer at a tab: 'settings' or 'controls'. */
  drawer(tab) {
    const menu = this.el('menu');
    menu.classList.add('drawer-open');
    for (const t of menu.querySelectorAll('.tab')) t.classList.toggle('on', t.dataset.tab === tab);
    for (const p of menu.querySelectorAll('.pane')) p.classList.toggle('on', p.dataset.pane === tab);
    menu.querySelector(`.tab[data-tab="${tab}"]`).focus({ preventScroll: true });
  }

  closeDrawer() { this.el('menu').classList.remove('drawer-open'); }

  get drawerOpen() { return this.el('menu').classList.contains('drawer-open'); }

  /** Keys on a menu: Esc closes the drawer, 1 2 3 pick a role card and the arrows move between them; the map has its own. */
  menuKey(e) {
    const menuOn = this.el('menu').style.display === 'flex', mapOn = this.el('map').style.display === 'flex';
    if (!menuOn && !mapOn) return;
    const stop = () => { e.preventDefault(); e.stopImmediatePropagation(); }; // (not on to the game's own keys)
    if (menuOn && this.drawerOpen) { if (e.code === 'Escape') { stop(); this.closeDrawer(); } return; }
    if (e.target.matches?.('input, select')) return;
    if (mapOn && this.mapKey?.(e)) { stop(); return; }
    const cards = [...this.el(mapOn ? 'map-roles' : 'menu-roles').querySelectorAll('.role-card')];
    const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1];
    if (n && cards[n - 1] && !e.repeat) { stop(); cards[n - 1].click(); return; }
    if ((e.code === 'ArrowRight' || e.code === 'ArrowLeft') && cards.length) {
      const i = cards.indexOf(document.activeElement);
      cards[i < 0 ? 0 : (i + (e.code === 'ArrowRight' ? 1 : cards.length - 1)) % cards.length].focus();
      stop();
    }
  }

  /** Which HUD to show: the bomber's (crew) or the fighter pilot's. */
  setMode(mode) {
    this.el('hud').dataset.mode = mode === 'crew' || mode === 'eject' ? mode : 'fighter';
    if (mode === 'crew') { this.el('gunsight').style.display = 'none'; this.el('flight').style.display = 'none'; this.el('nose').style.display = 'none'; Object.assign(this.el('crosshair').style, { left: '', top: '', display: '' }); }
  }

  /** The fighter pilot's instruments (null hides them). */
  fighter(s) {
    const box = this.el('flight'), nose = this.el('nose'), sight = this.el('gunsight');
    box.style.display = s ? 'block' : 'none';
    // the gunsight and the nose circle sit where the guns point; the crosshair is where you're steering
    const cross = this.el('crosshair'), flying = s && s.view !== 'chase';
    // (the cockpit's reflector sight is the gunsight; with the plain crosshair option, these instead)
    sight.style.display = flying && s.marker && !s.reflector ? 'block' : 'none';
    nose.style.display = s?.marker && !s.reflector && sight.style.display === 'none' ? 'block' : 'none'; // (not under the gunsight: one mark there)
    cross.style.display = !s || s.view === 'chase' || s.aim ? '' : 'none';
    const at = (el, p) => { el.style.left = p ? `${p.x * 100}%` : ''; el.style.top = p ? `${p.y * 100}%` : ''; };
    at(cross, flying ? s.aim : null);
    if (!s) return;
    if (s.marker) { at(nose, s.marker); at(sight, s.marker); }
    const ammo = Object.entries(s.ammo).map(([k, a]) => `<div>${k === 'cannon' ? '20 mm' : 'MG'} <b>${a.n}</b></div>`).join('');
    box.innerHTML = `<div class="lbl">${s.kind}${s.damage ? ` · <span class="warn">${s.damage}</span>` : ''}</div>
      <div><b>${Math.round(s.speed * 3.6)}</b> km/h · <b>${Math.round(s.alt).toLocaleString()}</b> ft</div>
      <div class="bar"><i style="width:${s.throttle * 100}%"></i></div><span class="lbl">Throttle ${Math.round(s.throttle * 100)}%</span>
      ${ammo}
      <div class="bar"><i style="width:${Math.min(1, s.heat) * 100}%;background:${s.jammed ? '#ff4a3a' : s.heat > 0.7 ? '#ffa23a' : '#d9d2b8'}"></i></div>
      <span class="lbl">${s.jammed ? 'Guns overheated' : 'Gun heat'}</span>`;
    this.health(s.health, null);
  }

  /**
   * A full-screen menu. kind sets the layout: 'loading', 'start', 'roles' (pick again after a sortie), or the
   * paper sheets 'pause', 'debrief' and 'over'. facts: the briefing strip [[label, value]]; status: the pause
   * sheet's mission at a glance (statusHtml); body: more HTML (a service record, the debrief); actions: more
   * buttons [{ label, onClick, style, confirm }] (confirm: the button asks once more before it acts).
   */
  menu({ kind = 'start', title, kicker = '', sub = '', text, facts = null, stamp = '', button, onClick, quality, onQuality, roles = null,
    status = null, body = '', actions = [], hint = '', seats = null, onSeat = null }) {
    const menu = this.el('menu'), card = this.el('menu-card');
    menu.dataset.kind = kind;
    this.seatPick = null;
    const sheet = ['pause', 'debrief', 'over'].includes(kind);
    card.classList.toggle('sheet', sheet);
    card.dataset.head = kind === 'pause' ? 'Restricted · Mission in progress' : sheet ? 'Restricted · Interrogation report' : '';
    this.el('menu-kicker').textContent = kicker;
    this.el('menu-title').textContent = title;
    this.el('menu-sub').textContent = sub;
    this.el('menu-stamp').textContent = stamp;
    const brief = this.el('menu-text');
    clearInterval(this.typing);
    if (kind === 'start' && text && !this.briefed) { this.briefed = true; this.typewrite(brief, text); } else brief.textContent = text ?? '';
    this.el('menu-facts').innerHTML = facts ? facts.map(([k, v]) => `<div${k === 'Conditions' ? ' data-fact="cond"' : ''}><span>${k}</span><b>${v}</b></div>`).join('') : '';
    this.el('menu-status').innerHTML = status ? this.statusHtml(status) : '';
    if (status && !this.counted && !matchMedia('(prefers-reduced-motion: reduce)').matches) { // the first time: the numbers count up
      this.counted = true;
      for (const b of this.el('menu-status').querySelectorAll('b')) {
        const m = /^(\d[\d,]*)(.*)$/.exec(b.textContent), to = m ? +m[1].replace(/,/g, '') : 0;
        if (!m || to < 2) continue;
        const t0 = performance.now(), step = () => { const k = Math.min(1, (performance.now() - t0) / 450); b.textContent = `${Math.round(to * (1 - (1 - k) ** 3)).toLocaleString()}${m[2]}`; if (k < 1) requestAnimationFrame(step); };
        step();
      }
    }
    this.el('menu-body').innerHTML = body + (seats ? this.seatsHtml(seats) : '');
    for (const b of this.el('menu-body').querySelectorAll('.seat-btn[data-seat]')) b.onclick = () => onSeat(b.dataset.seat);
    if (kind !== 'loading') { this.el('menu-loading').innerHTML = ''; clearInterval(this.factTimer); }
    const go = this.el('menu-go');
    go.textContent = button ?? '';
    go.style.display = button ? '' : 'none';
    go.onclick = onClick;
    const extra = this.el('menu-extra');
    extra.innerHTML = '';
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = `btn ${a.style ?? 'ghost'}`;
      b.textContent = a.label;
      b.onclick = () => {
        if (a.confirm && !b.dataset.armed) { b.dataset.armed = 1; b.textContent = a.confirm; b.classList.add('danger'); return; }
        a.onClick();
      };
      extra.append(b);
    }
    this.el('menu-hint').innerHTML = hint;
    const q = this.el('menu-quality');
    if (quality) q.value = quality;
    if (onQuality) q.onchange = () => onQuality(q.value);
    this.roles('menu-roles', roles);
    this.closeDrawer();
    for (const el of card.children) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; } // (each page comes in afresh)
    menu.style.display = 'flex';
    this.el('map').style.display = 'none';
    this.el('hud').style.display = 'none';
  }

  /** Type a line out quickly (under half a second); the rest is there but clear, so nothing moves as it grows. */
  typewrite(el, text) {
    const t0 = performance.now(), dur = Math.min(450, text.length * 4);
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / dur), n = Math.ceil(text.length * k);
      el.innerHTML = `${esc(text.slice(0, n))}<span class="ghost">${esc(text.slice(n))}</span>`;
      if (k >= 1) clearInterval(this.typing);
    };
    this.typing = setInterval(step, 16);
    step();
  }

  /**
   * The loading screen: a checklist (steps), a bar that follows the pieces actually loading (total of them),
   * and a fact about the B-17 now and then. Returns { track(promise, step), tick(step) }: each piece done
   * moves the bar on, and a step is ticked off once every piece in it is in.
   */
  loading(steps, total, quality, onQuality) {
    this.menu({ kind: 'loading', kicker: 'Eighth Air Force · 14 October 1943', title: 'Black Thursday', sub: 'B-17 Flying Fortress', quality, onQuality });
    this.slides();
    const box = this.el('menu-loading');
    box.innerHTML = `<div class="checklist">${steps.map((s) => `<span>${s}</span>`).join('')}</div>
      <div class="progress"><i></i></div><div class="load-pct"><span id="load-what"></span><span id="load-pct"></span></div>
      <div class="fact"><span>Did you know</span><p></p></div>`;
    const marks = box.querySelectorAll('.checklist span'), bar = box.querySelector('.progress i');
    const pending = steps.map(() => 0), seen = steps.map(() => false);
    let done = 0;
    // the bar moves steadily: it eases towards how much is really done, and while it waits on something
    // slow (the last step, getting every shader ready) it creeps on a little, so it never sits still
    let shown = 0, last = performance.now();
    const pctEl = this.el('load-pct');
    const tickBar = (now) => {
      if (!box.isConnected || this.loadingDone) return;
      const dt = Math.min(0.1, (now - last) / 1000), real = Math.min(1, done / total);
      last = now;
      const ceiling = real >= 1 ? 1 : Math.min(0.97, real + 0.12);
      shown = Math.min(ceiling, shown + Math.max(0.03, (real - shown) * 2.2) * dt);
      if (real > shown + 0.25) shown = real - 0.25; // (never too far behind)
      bar.style.width = `${(shown * 100).toFixed(1)}%`;
      pctEl.textContent = `${Math.floor(shown * 100)}%`;
      requestAnimationFrame(tickBar);
    };
    this.loadingDone = false;
    requestAnimationFrame(tickBar);
    const show = () => {
      const now = steps.findIndex((_, i) => !seen[i] || pending[i] > 0);
      marks.forEach((m, i) => { m.className = seen[i] && !pending[i] ? 'done' : i === now ? 'now' : ''; });
      this.el('load-what').textContent = now < 0 ? 'Ready' : `${steps[now]}…`;
    };
    const fact = box.querySelector('.fact'), line = fact.querySelector('p');
    let f = Math.floor(Math.random() * FACTS.length);
    line.textContent = FACTS[f++ % FACTS.length];
    clearInterval(this.factTimer);
    this.factTimer = setInterval(() => {
      fact.classList.add('out');
      setTimeout(() => { line.textContent = FACTS[f++ % FACTS.length]; fact.classList.remove('out'); }, 300);
    }, 4500);
    show();
    return {
      track: (p, step) => { pending[step]++; seen[step] = true; show(); return p.finally(() => { pending[step]--; done++; show(); }); },
      tick: (step) => { seen[step] = true; done++; show(); },
    };
  }

  /**
   * The pause sheet's mission at a glance. s: { phase, detail, toTarget (s, or null once past it), role,
   * health (0..1, null when not flying), engines, crewFit, life, mission, lives, forces { total, healthy, damaged, down } }.
   */
  statusHtml(s) {
    const pct = (v) => Math.round(v * 100), l = s.life, f = s.forces;
    const meter = (v) => `<div class="meter"><i style="width:${pct(v)}%;background:var(${v > 0.6 ? '--fit' : v > 0.3 ? '--dmg' : '--fire'})"></i></div>`;
    const tile = (k, v, small = '', more = '') => `<div><span>${k}</span><b>${v}</b>${more}<small>${small}</small></div>`;
    const kills = l.kills + l.bombers, acc = l.fired ? ((100 * l.hits) / l.fired).toFixed(1) : '0.0';
    return [
      tile('Mission', s.phase, s.detail),
      tile('Target', s.toTarget != null ? mmss(s.toTarget) : 'Behind us', s.toTarget != null ? 'until it\'s under the bombsight' : 'heading for home'),
      s.health == null ? tile(s.role === 'crew' ? 'Your bomber' : 'Your fighter', '—', 'not flying')
        : tile(s.role === 'crew' ? 'Your bomber' : 'Your fighter', `${pct(s.health)}%`, s.role === 'crew' ? `${s.engines} of 4 engines · ${s.crewMen ? `${s.crewMen.alive} fit${s.crewMen.wounded ? `, ${s.crewMen.wounded} wounded` : ''}${s.crewMen.dead ? `, ${s.crewMen.dead} dead` : ''}` : `${s.crewFit} of 10 crew fit`}` : '', meter(s.health)),
      tile('This life', `${kills} kill${kills === 1 ? '' : 's'}`, `${l.hits} hits · ${acc}% accuracy`),
      tile('Mission score', s.mission.points.toLocaleString(), `${s.lives} ${s.lives === 1 ? 'life' : 'lives'} so far`),
      tile('The stream', `${f.healthy + f.damaged} of ${f.total}`, `${f.damaged} damaged · ${f.down} lost${f.men ? ` · men ${f.men.dead} dead, ${f.men.wounded} wounded` : ''}`),
    ].join('');
  }

  /** The pause sheet's crew positions: who's there, and whether you can take it. seats: [{ id, name, who, state, can, here }]. */
  seatsHtml(seats) {
    const word = { ok: '✓ Manned', wounded: '✚ Wounded', dead: '✕ KIA', bailed: '↓ Gone', free: '○ Free', you: '★ You', out: '✕ Knocked out' };
    return `<section class="seats"><h3>Change position</h3><div class="seat-grid2">${seats.map((s) => `<button class="seat-btn ${s.state}${s.here ? ' here' : ''}" ${s.can && !s.here ? `data-seat="${s.id}"` : 'disabled'}>
      <b>${s.name}</b><small>${esc(s.who ?? '')}</small>${s.job ? `<em>${esc(s.job)}</em>` : ''}<span class="chip ${s.state === 'you' ? 'player' : s.state === 'free' ? 'ok' : s.state}">${s.here ? word.you : word[s.state]}</span>${s.can && !s.here ? '<span class="take">Take it ›</span>' : ''}</button>`).join('')}</div></section>`;
  }

  /**
   * Behind the loading screen: scenes of the air war (taken from the game itself) one after another,
   * each slowly pushing in, cross-fading to the next.
   */
  slides() {
    const box = document.querySelector('#menu .m-slides');
    if (!box || box.childElementCount) return;
    box.innerHTML = LOADING_SHOTS.map((n, i) => `<i style="background-image:url(loading/${n}.jpg)"${i ? '' : ' class="on"'}></i>`).join('');
    const imgs = [...box.children];
    let k = 0;
    clearInterval(this.slideTimer);
    this.slideTimer = setInterval(() => {
      if (!box.isConnected || document.getElementById('menu')?.dataset.kind !== 'loading') { clearInterval(this.slideTimer); return; }
      imgs[k].classList.remove('on'); k = (k + 1) % imgs.length; imgs[k].classList.add('on');
    }, 4200);
  }

  play() {
    this.loadingDone = true;
    this.closeDrawer();
    clearInterval(this.factTimer);
    clearInterval(this.typing);
    this.el('menu').style.display = 'none';
    this.el('map').style.display = 'none';
    this.el('hud').style.display = 'block';
    document.activeElement?.blur?.(); // (so Space in the game doesn't press a hidden button)
  }

  /** Ammo, heat and reload timer for the gun the player is on (null hides it). */
  gun(s) {
    const box = this.el('gun');
    box.style.display = s ? 'block' : 'none';
    if (!s) return;
    this.el('gun-ammo').innerHTML = `<b>${s.ammo}</b> / ${s.max}`;
    const heat = this.el('gun-heat');
    heat.style.width = `${s.heat * 100}%`;
    heat.style.background = s.jammed ? '#ff4a3a' : s.heat > 0.7 ? '#ffa23a' : '#d9d2b8';
    const state = this.el('gun-state');
    if (s.reloading) state.textContent = `Reloading… ${s.reloadLeft.toFixed(1)} s`;
    else if (s.jammed) state.textContent = 'Overheated, let the barrels cool';
    else if (s.ammo === 0) state.textContent = 'Out of ammo';
    else state.textContent = s.ammo < s.max * 0.2 ? 'Low ammo: R to reload' : '';
    state.className = s.reloading || s.jammed || s.ammo < s.max * 0.2 ? 'warn' : '';
    this.el('gun-reload').parentElement.style.display = s.reloading ? 'block' : 'none';
    this.el('gun-reload').style.width = `${(1 - s.reloadLeft / s.reloadTime) * 100}%`;
  }

  /**
   * The formation map: pick any surviving bomber, then any fit AI crewman to take over. A briefing-room plot
   * on paper. It opens centred on where you were, zoomed out far enough to take in every bomber; drag pans,
   * the wheel zooms on the cursor, and the view can't wander off the formation. Hovering a bomber says how
   * she stands. crewOf(bomber) -> Crew. onPick(bomber, member) is called with the choice; record: the
   * service record of the life just ended (HTML).
   */
  map({ title, text, record = '', bombers, crewOf, mine, onPick, onRole, onBack = null }) {
    const box = this.el('map'), cv = this.el('map-canvas'), g = cv.getContext('2d'), side = this.el('map-side'), tip = this.el('map-tip');
    this.el('map-title').textContent = title;
    this.el('map-text').textContent = text;
    this.el('map-record').innerHTML = record;
    const back = this.el('map-back'); // (only when you came here by choice: there's somewhere to go back to)
    back.style.display = onBack ? '' : 'none';
    back.onclick = () => { box.style.display = 'none'; onBack(); };
    this.el('menu').style.display = 'none';
    this.el('hud').style.display = 'none';
    box.style.display = 'flex';
    this.roles('map-roles', onRole ? (id) => { box.style.display = 'none'; onRole(id); } : null, ['bf109', 'fw190', 'p47']);
    this.el('map-roles').parentElement.style.display = onRole ? '' : 'none';

    const fitCrew = (b) => crewOf(b).members.filter((m) => m.state === 'ok').length;
    const shown = bombers.filter((b) => !b.gone);
    const live = new Set(shown.filter((b) => !b.down && fitCrew(b) > 0));
    // the world stands still while you choose: the formation's extent is fixed
    const xs = shown.map((b) => b.base.x), zs = shown.map((b) => b.base.z), ys = shown.map((b) => b.base.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    // the 18-ship groups, boxed and named on the plot
    const groups = new Map();
    for (const b of shown) if (!b.down) (groups.get(b.squad) ?? groups.set(b.squad, []).get(b.squad)).push(b);

    let W = 0, H = 0, sMin = 0.01, sMax = 2;
    const view = { s: 1, cx: mine.base.x, cz: mine.base.z }, PAD = 60;
    const fitAll = () => ({ s: Math.min((W - 2 * PAD) / Math.max(300, x1 - x0), (H - 2 * PAD) / Math.max(300, z1 - z0)), cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 });
    const aroundMe = () => { // centred on where you were, out just far enough to take in every bomber
      let dx = 150, dz = 150;
      for (const b of shown) { dx = Math.max(dx, Math.abs(b.base.x - mine.base.x)); dz = Math.max(dz, Math.abs(b.base.z - mine.base.z)); }
      return { s: Math.min((W / 2 - PAD) / dx, (H / 2 - PAD) / dz), cx: mine.base.x, cz: mine.base.z };
    };
    const clampView = () => {
      view.s = clamp(view.s, sMin, sMax);
      view.cx = clamp(view.cx, x0, x1); // (the middle of the map never leaves the formation)
      view.cz = clamp(view.cz, z0, z1);
    };
    const setView = (v) => { Object.assign(view, v); clampView(); draw(); };
    const size = () => {
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
      if (!r.width || !r.height) return false;
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const a = fitAll().s, m = aroundMe().s;
      sMin = Math.min(a, m) * 0.75; sMax = Math.max(a * 40, 1.2);
      return true;
    };
    const px = (b) => [W / 2 + (b.base.x - view.cx) * view.s, H / 2 + (b.base.z - view.cz) * view.s];
    const radius = () => clamp(view.s * 15, 3.4, 13); // a bomber's mark, never too small to hit
    const zoomAt = (mx, my, k) => {
      const wx = view.cx + (mx - W / 2) / view.s, wz = view.cz + (my - H / 2) / view.s;
      view.s = clamp(view.s * k, sMin, sMax);
      view.cx = wx - (mx - W / 2) / view.s; view.cz = wz - (my - H / 2) / view.s;
      clampView(); draw();
    };
    const hit = (mx, my) => {
      let best = null, bd = Math.max(14, radius() + 6);
      for (const b of shown) {
        if (b.down) continue;
        const [x, y] = px(b), d = Math.hypot(x - mx, y - my);
        if (d < bd || (d === bd && live.has(b))) { bd = d; best = b; }
      }
      return best;
    };

    let hover = null, selected = null, drag = null;
    const INK = '#261f15', FIT = '#3f7d2a', DMG = '#c08a00', FIRE = '#c0281c', SPENT = '#8a8273', RED = '#b8352a';
    const plane = (x, y, r) => { // a bomber in plan view, nose up
      const P = [[0, -1], [0.12, -0.72], [0.12, -0.3], [1, -0.08], [1, 0.06], [0.12, 0.12], [0.09, 0.66], [0.42, 0.76], [0.42, 0.88], [0, 0.92]];
      g.beginPath();
      for (const [i, [a, b]] of P.entries()) g[i ? 'lineTo' : 'moveTo'](x + a * r, y + b * r);
      for (const [a, b] of P.slice().reverse()) g.lineTo(x - a * r, y + b * r);
      g.closePath();
    };
    const nice = (want) => [25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000].find((n) => n >= want) ?? 20000;
    const paper = (this.paperTex ??= paperTexture());
    const draw = () => {
      if (!W) return;
      g.save();
      g.fillStyle = g.createPattern(paper, 'repeat'); g.fillRect(0, 0, W, H);
      const stain = g.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.2, W * 0.5, H * 0.5, Math.max(W, H) * 0.75);
      stain.addColorStop(0, '#00000000'); stain.addColorStop(1, '#7a5a2a4d');
      g.fillStyle = stain; g.fillRect(0, 0, W, H);
      // the grid, lettered across and numbered down like a briefing map
      const step = nice(80 / view.s), wx0 = view.cx - W / 2 / view.s, wz0 = view.cz - H / 2 / view.s;
      g.lineWidth = 1; g.font = '600 13px "Barlow Condensed", system-ui, sans-serif'; g.textBaseline = 'top';
      for (let k = Math.floor(wx0 / step) * step; k < wx0 + W / view.s; k += step) {
        const x = Math.round(W / 2 + (k - view.cx) * view.s) + 0.5, n = Math.round(k / step);
        g.strokeStyle = n % 5 ? '#8f774b38' : '#8f774b70'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
        g.fillStyle = '#5d4f39aa'; if (x > 260 && x < W - 300) g.fillText(String.fromCharCode(65 + (((n % 26) + 26) % 26)), x + 4, 14);
      }
      for (let k = Math.floor(wz0 / step) * step; k < wz0 + H / view.s; k += step) {
        const y = Math.round(H / 2 + (k - view.cz) * view.s) + 0.5, n = Math.round(k / step);
        g.strokeStyle = n % 5 ? '#8f774b38' : '#8f774b70'; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        g.fillStyle = '#5d4f39aa'; if (y > 70 && y < H - 60) g.fillText(String(((n % 100) + 100) % 100).padStart(2, '0'), W - 30, y + 3);
      }
      // the combat boxes: each group dashed round and named, once there's room
      g.setLineDash([5, 4]); g.lineWidth = 1;
      for (const list of groups.values()) {
        let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
        for (const m of list) { const [x, y] = px(m); a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
        const r = radius() + 8;
        if (c - a < 40 || c < -r || a > W + r || d < -r || b > H + r) continue;
        g.strokeStyle = '#261f1566'; g.strokeRect(a - r, b - r, c - a + 2 * r, d - b + 2 * r);
        g.fillStyle = '#261f15b0'; g.textBaseline = 'bottom';
        g.fillText(list[0].label.replace(/, \w+ squadron$/, '').toUpperCase(), a - r, b - r - 3);
      }
      g.setLineDash([]); g.textBaseline = 'middle';
      // the bombers: shot down ones crossed out, the rest by state; paler is lower in the stack
      const r0 = radius();
      for (const b of shown) {
        const [x, y] = px(b);
        if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
        if (b.down) {
          g.strokeStyle = '#261f1566'; g.lineWidth = 1.5; const k = Math.min(5, r0 * 0.6);
          g.beginPath(); g.moveTo(x - k, y - k); g.lineTo(x + k, y + k); g.moveTo(x + k, y - k); g.lineTo(x - k, y + k); g.stroke();
          continue;
        }
        const up = (b.base.y - y0) / Math.max(1, y1 - y0);
        g.globalAlpha = 0.5 + up * 0.5;
        g.fillStyle = !live.has(b) ? SPENT : b.burning ? FIRE : b.deadEngines || b.damaged ? DMG : FIT;
        g.strokeStyle = INK; g.lineWidth = 0.8;
        if (r0 >= 6) { plane(x, y, r0); g.fill(); g.stroke(); } else { g.beginPath(); g.arc(x, y, r0, 0, 7); g.fill(); g.stroke(); }
        g.globalAlpha = 1;
      }
      // where you were (an inked ring), the bomber you picked (a grease-pencil circle), the one under the cursor
      const ring = (b, r, col, w, dash = []) => { const [x, y] = px(b); g.setLineDash(dash); g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke(); g.setLineDash([]); };
      if (hover && hover !== selected) ring(hover, r0 + 7, '#9a7426', 2);
      if (selected) { ring(selected, r0 + 9, RED, 2.6); ring(selected, r0 + 12, '#b8352a66', 1.2); }
      if (!mine.gone) {
        ring(mine, r0 + 6, INK, 1.6, [3, 3]);
        const [x, y] = px(mine);
        g.fillStyle = INK; g.font = '700 14px "Barlow Condensed", system-ui, sans-serif'; g.fillText('YOU WERE HERE', x + r0 + 12, y - r0 - 8);
      }
      // the heading marker, the title, the scale and the frame
      const hx = 40, hy = 44;
      g.strokeStyle = INK; g.lineWidth = 1.2; g.beginPath(); g.arc(hx, hy, 20, 0, 7); g.stroke();
      for (let i = 0; i < 4; i++) { const a = (i * Math.PI) / 2; g.beginPath(); g.moveTo(hx + Math.sin(a) * 20, hy - Math.cos(a) * 20); g.lineTo(hx + Math.sin(a) * 25, hy - Math.cos(a) * 25); g.stroke(); }
      g.fillStyle = RED; g.beginPath(); g.moveTo(hx, hy - 17); g.lineTo(hx + 6, hy + 4); g.lineTo(hx, hy); g.closePath(); g.fill();
      g.fillStyle = INK; g.beginPath(); g.moveTo(hx, hy - 17); g.lineTo(hx - 6, hy + 4); g.lineTo(hx, hy); g.closePath(); g.fill();
      g.font = '700 13px "Barlow Condensed", system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('HEADING', hx, hy + 34); g.textAlign = 'left';
      g.font = '20px "Special Elite", "Courier New", monospace'; g.fillText('FORMATION PLOT', 78, 34);
      g.fillStyle = '#3d3222'; g.font = '500 15px Barlow, system-ui, sans-serif'; g.fillText(`${live.size} bombers with men to spare`, 78, 56);
      const L = nice(110 / view.s), lw = L * view.s, sx = W - 22 - lw, sy = H - 26;
      for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#efe6cc' : INK; g.fillRect(sx + (i * lw) / 4, sy, lw / 4, 5); }
      g.strokeStyle = INK; g.lineWidth = 1; g.strokeRect(sx + 0.5, sy + 0.5, lw, 5);
      g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'bottom';
      g.fillText('0', sx, sy - 3); g.textAlign = 'right'; g.fillText(L >= 1000 ? `${L / 1000} km` : `${L} m`, sx + lw, sy - 3); g.textAlign = 'left';
      g.strokeStyle = INK; g.lineWidth = 2; g.strokeRect(5, 5, W - 10, H - 10);
      g.lineWidth = 0.7; g.strokeRect(9.5, 9.5, W - 19, H - 19);
      g.restore();
    };

    const heightWord = (b) => {
      const ft = Math.round(((b.base.y - mine.base.y) * 3.281) / 50) * 50;
      return ft === 0 ? 'level with where you were' : `${Math.abs(ft).toLocaleString()} ft ${ft > 0 ? 'above' : 'below'} where you were`;
    };
    const setTip = (b, mx, my) => {
      if (!b) { tip.style.display = 'none'; return; }
      const n = fitCrew(b), running = 4 - b.deadEngines;
      tip.innerHTML = `<b>${esc(b.label || 'B-17')}</b>
        <div><span>Engines</span> ${running} of 4 running${b.burning ? ' · <span class="hot">on fire</span>' : ''}</div>
        <div><span>Airframe</span> ${Math.round(b.health * 100)}%</div>
        <div><span>Crew</span> ${n} of 10 fit</div>
        <div><span>Height</span> ${heightWord(b)}</div>
        <div class="cta"${live.has(b) ? '' : ' style="color:var(--fire)"'}>${live.has(b) ? 'Click: her crew · double-click: board her' : 'No one left to take over'}</div>`;
      tip.style.display = 'block';
      const tw = tip.offsetWidth, th = tip.offsetHeight; // beside the cursor, inside the map
      let x = mx + 18, y = my + 16;
      if (x + tw > W - 8) x = mx - tw - 18;
      if (y + th > H - 8) y = my - th - 16;
      tip.style.left = `${Math.max(8, x)}px`; tip.style.top = `${Math.max(8, y)}px`;
    };
    const STATUS = { ok: 'Fit', wounded: 'Wounded', dead: 'KIA', bailed: 'Bailed out', player: 'You' };
    const showSide = (b) => {
      const crew = crewOf(b), grp = (b.label || 'B-17').replace(/, \w+ squadron$/, ''), sq = /(\w+ squadron)$/.exec(b.label ?? '')?.[1] ?? '';
      side.innerHTML = `<div class="sq">${esc(sq)}</div><h3>${esc(grp)}</h3>
        <div class="state"><span>${4 - b.deadEngines} of 4 engines</span><span>Airframe ${Math.round(b.health * 100)}%</span>${b.burning ? '<span class="hot">On fire</span>' : ''}<span>${fitCrew(b)} of 10 fit</span></div>
        <div class="rows">${crew.members.map((m, i) => {
          const name = m.name.startsWith(m.role.rank) ? m.name.slice(m.role.rank.length).trim() : m.name;
          return `<button class="crew-row" data-i="${i}" ${m.state === 'ok' || m.state === 'player' ? '' : 'disabled'}><span class="rk">${m.role.rank}</span>
            <span class="who"><b>${esc(name)}</b><small>${m.role.title}</small></span><span class="chip ${m.state}">${STATUS[m.state] ?? m.state}</span></button>`;
        }).join('')}</div>`;
      for (const btn of side.querySelectorAll('.crew-row')) btn.onclick = () => { box.style.display = 'none'; onPick(b, crew.members[+btn.dataset.i]); };
    };
    const select = (b) => { selected = b; draw(); showSide(b); };
    // straight aboard: as one of her gunners if one's fit, or whoever is
    const GUNS = ['tail', 'top', 'ball', 'waistL', 'waistR', 'radio', 'cheekL', 'cheekR', 'noseL', 'noseR'];
    const board = (b) => {
      const fit = crewOf(b).members.filter((m) => m.state === 'ok');
      const m = GUNS.map((id) => fit.find((x) => x.role.station === id)).find(Boolean) ?? fit[0];
      if (!m) return;
      box.style.display = 'none'; onPick(b, m);
    };

    const local = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    cv.onpointerdown = (e) => { drag = { x: e.clientX, y: e.clientY, cx: view.cx, cz: view.cz, moved: false }; cv.setPointerCapture(e.pointerId); };
    cv.onpointermove = (e) => {
      const [mx, my] = local(e);
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) > 4) { drag.moved = true; cv.classList.add('drag'); setTip(null); }
        if (drag.moved) { view.cx = drag.cx - dx / view.s; view.cz = drag.cz - dy / view.s; clampView(); draw(); }
        return;
      }
      const h = hit(mx, my);
      if (h !== hover) { hover = h; draw(); }
      setTip(h, mx, my);
      cv.classList.toggle('over', !!h && live.has(h));
    };
    cv.onpointerup = (e) => {
      if (drag && !drag.moved) { const h = hit(...local(e)); if (h && live.has(h)) select(h); }
      drag = null; cv.classList.remove('drag');
    };
    cv.ondblclick = (e) => { const h = hit(...local(e)); if (h && live.has(h)) board(h); };
    cv.onpointerleave = () => { if (!drag && hover) { hover = null; setTip(null); draw(); } };
    cv.onwheel = (e) => { e.preventDefault(); zoomAt(...local(e), e.deltaY < 0 ? 1.25 : 0.8); };
    for (const b of box.querySelectorAll('[data-z]')) {
      b.onclick = () => ({ in: () => zoomAt(W / 2, H / 2, 1.4), out: () => zoomAt(W / 2, H / 2, 1 / 1.4), fit: () => setView(fitAll()), me: () => setView({ cx: mine.base.x, cz: mine.base.z }) })[b.dataset.z]();
    }
    this.mapKey = (e) => {
      const pan = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.code];
      if (pan) { view.cx += (pan[0] * 90) / view.s; view.cz += (pan[1] * 90) / view.s; clampView(); draw(); return true; }
      if (e.code === 'Equal' || e.code === 'NumpadAdd') { zoomAt(W / 2, H / 2, 1.4); return true; }
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') { zoomAt(W / 2, H / 2, 1 / 1.4); return true; }
      if (e.code === 'Digit0' || e.code === 'Numpad0') { setView(fitAll()); return true; }
      return false;
    };
    // the canvas follows the window; the plot is redrawn only when something changes
    this.mapResize = () => { if (box.style.display === 'flex' && size()) { clampView(); draw(); } };
    if (!this.mapObserver) {
      this.mapObserver = new ResizeObserver(() => this.mapResize());
      this.mapObserver.observe(cv);
      document.fonts?.ready.then(() => this.mapResize());
    }
    if (size()) Object.assign(view, aroundMe());
    clampView();
    // start with the nearest fit bomber picked
    let near = null;
    for (const b of live) if (!near || b.base.distanceTo(mine.base) < near.base.distanceTo(mine.base)) near = b;
    hover = null; setTip(null);
    if (near) select(near);
    else { draw(); side.innerHTML = '<h3>No one left</h3><p class="empty">No bomber has a fit man left to take over.</p>'; }
  }

  mission(text) { if (text !== this.lastMission) this.el('mission').textContent = this.lastMission = text; }

  /** The strength of both sides, at a glance (b: bombers { total, healthy, damaged, down }, f: Fighters.counts()). */
  /**
   * Both sides at a glance, under the mission line: each side's insignia, its strength as a bar (bombers:
   * healthy, damaged, lost; fighters: in the air, shot down, still to come) and the numbers beside it.
   */
  forces(b, f) {
    const pct = (n, of) => `${(100 * n) / Math.max(1, of)}%`;
    const row = (cls, badge, name, total, segs, text) => `<div class="fr ${cls}">${badge}<span class="fn">${name}</span><b class="ft">${total}</b>
      <span class="fbar">${segs.map(([c, n]) => `<i class="${c}" style="width:${pct(n, total)}"></i>`).join('')}</span><span class="fx">${text}</span></div>`;
    const fa = f.axis, fl = f.allied, B = (this.badges ??= { us: EMBLEM.crew(), them: EMBLEM.bf109(), p47: EMBLEM.p47() }); // (made once: the P-47's has its own id)
    const html = row('us', B.us, 'B-17', b.total, [['ok', b.healthy], ['dmg', b.damaged], ['down', b.down]],
      `<em class="ok">${b.healthy}</em> healthy · <em class="dmg">${b.damaged}</em> damaged · <em class="down">${b.down}</em> lost${b.aborted ? ` · ${b.aborted} turned back` : ''}`)
      + row('them', B.them, 'Luftwaffe', fa.total, [['air', fa.air], ['down', fa.down], ['left', fa.reserve]],
        `<em class="air">${fa.air}</em> up${fa.fw ? ` (${fa.fw} Fw 190)` : ''} · <em class="down">${fa.down}</em> down · <em class="left">${fa.reserve}</em> to come`)
      + row('us', B.p47, 'P-47', fl.total, [['air', fl.air], ['down', fl.down], ['left', fl.reserve]],
        `<em class="air">${fl.air}</em> up · <em class="down">${fl.down}</em> down · <em class="left">${fl.reserve}</em> to come`);
    if (html !== this.lastForces) this.el('forces').innerHTML = this.lastForces = html;
  }

  /** The Norden bombsight view (null hides it). */
  sight(s) {
    this.el('sight').style.display = s ? 'block' : 'none';
    this.el('crosshair').style.display = s ? 'none' : '';
    if (!s) return;
    const lr = Math.abs(s.across) < 15 ? 'on course' : `target ${Math.round(Math.abs(s.across))} m ${s.across > 0 ? 'right: D' : 'left: A'}`;
    this.el('sight-info').innerHTML = s.released ? `<b>BOMBS AWAY</b> · ${s.bombs} left in the racks`
      : s.phase !== 'bombrun' ? 'Bomb run not started: the target is still beyond the horizon'
        : `Target <b>${(Math.max(0, s.along) / 1000).toFixed(2)} km</b> to the crosshair · ${lr}<br>
           <span class="keys">A / D steer the formation · <b>Space</b> or click: release when the target is on the crosshair · E leave</span>`;
  }

  /** End-of-mission debrief: the interrogation report. */
  debrief(d, onAgain, onQuality = () => {}, role = 'crew') {
    if (role !== 'crew') return this.pilotDebrief(d, onAgain, onQuality, role);
    const pct = d.dropped ? Math.round((d.onTarget / d.dropped) * 100) : 0;
    const mine = d.playerDropped ? Math.round((d.playerOnTarget / d.playerDropped) * 100) : null;
    const rating = pct > 45 ? 'Excellent' : pct > 30 ? 'Good' : pct > 15 ? 'Fair' : 'Poor';
    const f = d.forces;
    this.menu({
      kind: 'debrief', kicker: 'Interrogation report', title: 'Mission complete', button: 'Fly again', onClick: onAgain, onQuality,
      body: `<div class="debrief">
        <div>${this.section('Bombing', [
          ['Bombs within 1,000 ft of the aiming point', `${pct}% of ${d.dropped}`],
          ['Your bombs on target', mine == null ? 'none dropped' : `${mine}% of ${d.playerDropped}`],
          ['Target buildings destroyed', `${d.destroyed} of ${d.buildings}`]])}
          ${this.section('Your crew', [
          ['Crewmen saved by first aid', `${d.saved} (${d.savedByYou} by you)`],
          ['Your crew home safe', `${d.crewHome} of 10`],
          ...(d.crewMen ? [['Your crew', `${d.crewMen.alive} fit · ${d.crewMen.wounded} wounded · ${d.crewMen.dead} dead`]] : [])])}</div>
        <div>${this.section('The air battle', [
          ['Fighters shot down by you', d.kills.player],
          ['… by your crews\' gunners', d.kills.crew],
          ['… by the escorts', d.kills.escorts],
          ['Escorts lost', d.kills.alliedLost],
          ['Bf 109s and Fw 190s', `${f.f.axis.down} down of ${f.f.axis.total - f.f.axis.reserve} sent up`],
          ['P-47s', `${f.f.allied.down} lost of ${f.f.allied.total - f.f.allied.reserve} sent up`]])}
          ${this.section('The stream', [
          ['B-17s lost', `${d.bombersLost} of ${d.bombers}`],
          ['At the end', `${f.b.healthy} healthy, ${f.b.damaged} damaged${f.b.aborted ? `, ${f.b.aborted} turned back early` : ''}`],
          ...(d.men ? [['Men in the bombers home', `${d.men.alive} fit · ${d.men.wounded} wounded · ${d.men.dead} dead`]] : [])])}</div>
        <div class="db-rec"><div class="stamp rating ${rating.toLowerCase()}"><small>Bombing</small>${rating}</div>
          ${this.lifeCard(d.score, 'Whole mission')}</div>
      </div>`,
    });
  }

  /** End of the mission as a fighter pilot. */
  pilotDebrief(d, onAgain, onQuality, role) {
    const p = d.pilot, f = d.forces;
    this.menu({
      kind: 'debrief', kicker: role !== 'p47' ? 'Gefechtsbericht · combat report' : 'Interrogation report', title: role !== 'p47' ? 'Einsatz beendet' : 'Mission complete',
      button: 'Fly again', onClick: onAgain, onQuality,
      body: `<div class="debrief">
        <div>${this.section('Your sorties', [
          ...(role !== 'p47' ? [['B-17s you brought down', p.bombers], ['P-47s you shot down', p.fighters]]
            : [['Bf 109s you shot down', p.fighters], ['Attacks you broke up (bombers saved)', p.saved]]),
          ['Times you were shot down', p.deaths]])}</div>
        <div>${this.section('The air battle', [
          ['B-17s lost', `${d.bombersLost} of ${d.bombers}`],
          ['Luftwaffe fighters lost (all)', d.kills.axisLost ?? 0],
          ['P-47s lost (all)', d.kills.alliedLost],
          ['B-17s at the end', `${f.b.healthy} healthy, ${f.b.damaged} damaged`],
          ['Bombs within 1,000 ft of the aiming point', `${d.dropped ? Math.round((d.onTarget / d.dropped) * 100) : 0}% of ${d.dropped}`]])}</div>
        <div class="db-rec">${this.lifeCard(d.score, 'Whole mission')}</div>
      </div>`,
    });
  }

  /** A titled list of typed results, for the debrief. */
  section(name, rows) {
    return `<section class="db-sec"><h3>${name}</h3><dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl></section>`;
  }

  /** Crew list: who's on which gun, who's hit (with time left), who's gone. */
  crew(members) {
    const html = members.map((m) => {
      const s = m.state === 'player' ? `<span class="you">YOU</span>${m.standIn ? ' <span class="ok" title="manned while you are away">●</span>' : ''}`
        : m.state === 'wounded' ? `<span class="hurt">WOUNDED ${Math.ceil(m.woundLeft)}s</span>`
          : m.state === 'dead' ? '<span class="dead">KIA</span>'
            : m.state === 'bailed' ? '<span class="busy">BAILED OUT</span>'
              : m.task === 'helping' ? '<span class="busy">FIRST AID</span>' : '<span class="ok">●</span>';
      const once = m.patched && (m.state === 'ok' || m.state === 'player') ? ' <span class="hurt" title="Wounded once: the next wound like that kills him">✚1</span>' : '';
      return `<div class="${m.state}">${m.role.title}${once}<b>${s}</b></div>`;
    }).join('');
    if (html !== this.lastCrew) this.el('crew').innerHTML = this.lastCrew = html;
  }

  /**
   * The four engines, numbered as the pilot sees them, plus wing fires: only when it matters (an engine
   * in trouble, a wing on fire, going down) or while you're at the controls (show).
   */
  engines(bomber, show = false) {
    const trouble = bomber.down || bomber.tankFire[-1] || bomber.tankFire[1] || bomber.engines.some((e) => e.state !== 'ok' || e.feathered);
    this.el('engines').style.display = show || trouble ? 'flex' : 'none';
    const label = { ok: '', smoking: 'SMOKING', dead: 'OUT', fire: 'FIRE' };
    let html = bomber.engines.map((e, i) => `<span class="eng ${e.state}">${i + 1}<small>${label[e.state]}</small></span>`).join('');
    if (bomber.tankFire[-1] || bomber.tankFire[1]) html += '<span class="eng fire wing">WING FIRE</span>';
    if (bomber.down) html += '<span class="eng fire wing">GOING DOWN</span>';
    if (html !== this.lastEng) this.el('engines').innerHTML = this.lastEng = html;
  }

  /** The airframe health bar (0..1) and the fire bottles left. */
  /**
   * The damage diagram: a top-down B-17 made of its parts (wings inner and outer, engines, tail,
   * turrets, the fuselage section by section), each tinted from its normal colour through light red
   * and dark red to black as it's shot up. A part that has broken off is gone from the picture.
   * Burning parts flicker orange. Plus the overall figure and the fire bottles left.
   */
  health(h, bottles, bomber) {
    const svg = this.el('dmg');
    if (!svg.childElementCount || svg.dataset.kind) { // (back from a fighter: the B-17 again)
      svg.dataset.kind = ''; svg.setAttribute('viewBox', '0 0 200 140'); svg.innerHTML = DIAGRAM;
      this.lastDmg = this.lastHealth = null;
    }
    const key = bomber ? damageKey(bomber) : '';
    const pct = Math.round(h * 100);
    if (key !== this.lastDmg) {
      this.lastDmg = key;
      if (bomber) for (const el of svg.querySelectorAll('[data-part]')) {
        const name = el.dataset.part, d = bomber.damage(name);
        const e = name.startsWith('engine') ? bomber.engines[+name.slice(6) - 1] : null;
        const burning = e?.state === 'fire' || (name === 'wingLi' && bomber.tankFire[-1] > 0) || (name === 'wingRi' && bomber.tankFire[1] > 0) || bomber.secFire?.[name] > 0;
        el.style.display = bomber.lost[name] ? 'none' : '';
        el.style.fill = e?.state === 'dead' ? '#1b1b1b' : damageColour(d);
        el.classList.toggle('burning', !!burning);
      }
    }
    if (pct === this.lastHealth && bottles === this.lastBottles) return;
    this.lastHealth = pct; this.lastBottles = bottles;
    this.el('health-pct').textContent = bottles == null ? `${pct}%` : `${pct}% · ${bottles} fire bottle${bottles === 1 ? '' : 's'}`;
  }

  /**
   * Flying a fighter: the same diagram for your own plane, its type's plan view in parts (engine,
   * cockpit, fuel tank, wings, fuselage, tail), each tinted as it's shot up; the engine flickers when on fire.
   */
  fighterDamage(f) {
    const svg = this.el('dmg');
    if (svg.dataset.kind !== f.kind) {
      svg.dataset.kind = f.kind; svg.setAttribute('viewBox', '0 0 100 100'); svg.innerHTML = FDIAGRAM[f.kind] ?? '';
      this.lastDmg = this.lastHealth = null;
    }
    const key = Object.values(f.parts).map((v) => Math.round(v * 4)).join() + f.burning + f.smoking + f.alive;
    if (key === this.lastDmg) return;
    this.lastDmg = key;
    let left = 0, all = 0;
    for (const [n, p] of Object.entries(f.k.parts)) { left += Math.max(0, f.parts[n]); all += p.hp; }
    for (const el of svg.querySelectorAll('[data-part]')) {
      const n = el.dataset.part, hp = f.k.parts[n]?.hp ?? 1;
      el.style.fill = damageColour(1 - Math.max(0, f.parts[n] ?? hp) / hp);
      el.classList.toggle('burning', n === 'engine' && f.burning);
    }
    const pct = f.alive ? Math.round((left / all) * 100) : 0;
    this.lastHealth = pct;
    this.el('health-pct').textContent = `${f.k.name} · ${pct}%`;
  }

  /** Flight instruments while you're at the controls (null hides them). */
  flight(f) {
    const box = this.el('flight'), nose = this.el('nose');
    box.style.display = f ? 'block' : 'none';
    nose.style.display = f?.nose ? 'block' : 'none';
    if (!f) { this.el('speedwarn').style.display = 'none'; return; }
    if (f.nose) { nose.style.left = `${f.nose.x * 100}%`; nose.style.top = `${f.nose.y * 100}%`; }
    box.innerHTML = `<div><b>${Math.round(f.mph)}</b> mph</div><div><b>${Math.round(f.feet).toLocaleString()}</b> ft</div>
      <div>Heading <b>${Math.round(f.heading).toString().padStart(3, '0')}°</b> · bank ${Math.round(f.bank)}°</div>
      <div class="bar"><i style="width:${f.throttle * 100}%"></i></div><span class="lbl">Throttle ${Math.round(f.throttle * 100)}%</span>
      <div class="lbl">${f.offset > 60 ? `${Math.round(f.offset)} m out of formation` : 'In formation'}</div>`;
    // an engine out: you've lost power, and only more throttle on the others keeps you in the box
    const w = this.el('speedwarn'), p = f.power;
    const short = p && f.throttle < Math.min(1, p.need) - 0.02, falling = f.behind > 25;
    w.style.display = p && (short || falling) ? 'block' : 'none';
    if (p && (short || falling)) {
      const e = p.lost[0], what = e.state === 'fire' ? 'on fire' : e.state === 'smoking' ? 'damaged' : e.feathered ? 'feathered' : 'windmilling';
      w.innerHTML = `<b>Losing speed</b> — engine ${e.n} ${what}${p.lost.length > 1 ? ` (${p.lost.length} engines out)` : ''}.<br>`
        + (p.need > 1 ? 'Full throttle won\'t hold the formation' : short ? `Increase throttle to ${Math.round(p.need * 100)}% to stay in formation` : 'More throttle to catch up with your slot')
        + (falling ? ` · <b>${Math.round(f.behind)} m</b> behind` : '');
    }
  }

  /** Your health, top left (null hides it: flying a fighter, your plane's own health shows instead). */
  /**
   * The mini map: a round radar plot, always up in the corner, turned with your view (straight up is where
   * you're looking). You in the middle; the B-17s as grey dots (paler lower down, crosses for the ones going
   * down), the P-47s blue, the Luftwaffe red; the target's bearing and range on the rim. d: { at, yaw,
   * bombers, fighters, target, side, range }.
   */
  minimap(d) {
    const box = this.el('minimap');
    box.style.display = d ? 'block' : 'none';
    if (!d) return;
    const cv = this.el('minimap-canvas'), g = cv.getContext('2d'), S = cv.width, R = S / 2 - 8, k = R / d.range;
    const cs = Math.cos(d.yaw), sn = Math.sin(d.yaw);
    const plot = (p) => { const dx = p.x - d.at.x, dz = p.z - d.at.z; return [S / 2 + (dx * cs - dz * sn) * k, S / 2 + (dx * sn + dz * cs) * k]; };
    g.clearRect(0, 0, S, S);
    g.save(); g.beginPath(); g.arc(S / 2, S / 2, R, 0, 7); g.clip();
    g.fillStyle = '#0d110bcc'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#c9a55a33'; g.lineWidth = 2;
    for (const f of [1 / 3, 2 / 3]) { g.beginPath(); g.arc(S / 2, S / 2, R * f, 0, 7); g.stroke(); } // 1 km rings
    g.beginPath(); g.moveTo(S / 2, 8); g.lineTo(S / 2, S - 8); g.moveTo(8, S / 2); g.lineTo(S - 8, S / 2); g.stroke();
    for (const b of d.bombers) { // the stream
      if (b.gone) continue;
      const [x, y] = plot(b.group.position);
      if (x < 0 || y < 0 || x > S || y > S) continue;
      if (b.down) { g.strokeStyle = '#ff6a4a'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 4, y - 4); g.lineTo(x + 4, y + 4); g.moveTo(x + 4, y - 4); g.lineTo(x - 4, y + 4); g.stroke(); continue; }
      g.fillStyle = b.straggling ? '#e8b04a' : '#b9bfc4'; g.beginPath(); g.arc(x, y, 3.6, 0, 7); g.fill();
    }
    for (const f of d.fighters) {
      if (!f.alive || f.player) continue;
      const [x, y] = plot(f.pos);
      if (x < 0 || y < 0 || x > S || y > S) continue;
      g.fillStyle = f.side === 'axis' ? '#ff3a2a' : '#4aa0ff';
      g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 4.5, y + 4); g.lineTo(x - 4.5, y + 4); g.closePath(); g.fill();
    }
    g.restore();
    // the rim (red in the flak belt), the target's bearing, you
    g.strokeStyle = d.flak ? `rgba(255,${120 - d.flak * 80 | 0},70,${0.5 + d.flak * 0.5})` : '#c9a55a99'; g.lineWidth = d.flak ? 5 : 3; g.beginPath(); g.arc(S / 2, S / 2, R, 0, 7); g.stroke();
    if (d.flak) { g.fillStyle = '#ff8a6a'; g.font = '700 22px "Barlow Condensed", system-ui'; g.textAlign = 'center'; g.fillText('FLAK', S / 2, 44); }
    if (d.target) {
      const dx = d.target.x - d.at.x, dz = d.target.z - d.at.z, a = Math.atan2(dx * sn + dz * cs, dx * cs - dz * sn), dist = Math.hypot(dx, dz);
      const x = S / 2 + Math.cos(a) * (R - 2), y = S / 2 + Math.sin(a) * (R - 2);
      g.fillStyle = '#ff5040'; g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 4, 0, 7); g.stroke();
      g.fillStyle = '#ece8dc'; g.font = '600 20px system-ui'; g.textAlign = 'center';
      g.fillText(`TARGET ${(dist / 1000).toFixed(0)} km`, S / 2, S - 26);
    }
    g.fillStyle = '#ffd24a'; g.strokeStyle = '#000'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(S / 2, S / 2 - 11); g.lineTo(S / 2 + 8, S / 2 + 8); g.lineTo(S / 2, S / 2 + 3); g.lineTo(S / 2 - 8, S / 2 + 8); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = '#ece8dc99'; g.font = '600 17px system-ui'; g.textAlign = 'left'; g.fillText(`${d.range / 1000} km`, 14, S - 12);
  }

  /**
   * You: your health, and a small figure of you (seen from behind: its left is your left) whose head, body,
   * arms and legs are tinted as they're hurt (wounds: player.wounds, 0..1 each), like the bomber's diagram.
   */
  you(h, wounds = null) {
    const el = this.el('you');
    el.style.display = h == null ? 'none' : 'flex';
    const key = wounds ? Object.values(wounds).map((v) => Math.round(v * 20)).join() : '';
    if (wounds && key !== this.lastWounds) {
      this.lastWounds = key;
      for (const p of el.querySelectorAll('[data-z]')) p.style.fill = damageColour(wounds[p.dataset.z] ?? 0);
      const worst = Object.entries(wounds).filter(([, v]) => v > 0.05).sort((a, b) => b[1] - a[1])[0];
      const NAME = { head: 'Head', torso: 'Chest', armL: 'Left arm', armR: 'Right arm', legL: 'Left leg', legR: 'Right leg' };
      this.el('you-zone').textContent = worst ? `${NAME[worst[0]]} ${worst[1] > 0.6 ? 'badly hurt' : 'hurt'}` : '';
    }
    if (h == null || h === this.lastYou) return;
    if (this.lastYou != null && h < this.lastYou) this.hitFlash(Math.min(1, (this.lastYou - h) * 3));
    this.lastYou = h;
    const bar = this.el('you-bar');
    bar.style.width = `${Math.round(h * 100)}%`;
    bar.style.background = h > 0.6 ? '#7fbf5a' : h > 0.3 ? '#e0a832' : '#d8452f';
    this.el('you-pct').textContent = `${Math.round(h * 100)}`;
  }

  /**
   * The bomber you're in, as the records have her (I): serial, type, name, group and squadron, code, pilot,
   * what became of her that day, and her crew by station with each man's recorded fate. Only what's on
   * record is shown; an unknown is said to be unknown, a placeholder crewman is marked as one, and each
   * line carries how sure the record is (VERIFIED / PROBABLE / UNVERIFIED). d: null hides it.
   */
  identity(d) {
    const el = this.el('ident');
    if (!d) { el.style.display = 'none'; return; }
    const i = d.ident ?? {}, unk = '<i class="unk">unknown</i>', conf = (c) => (c ? `<span class="conf ${c.toLowerCase()}">${c}</span>` : '');
    const OUT = { bombed: 'bombed the target', aborted: 'turned back (abort)', returned_damaged: 'returned damaged', written_off: 'written off', lost: 'lost', unknown: 'not known' };
    const row = (k, v) => `<div><span>${k}</span><b>${v ?? unk}</b></div>`;
    el.innerHTML = `<div class="id-head"><span>B-17${i.type ? ` ${esc(i.type.replace(/^B-17/, ''))}` : ''} Flying Fortress</span><b>${i.nickname ? `“${esc(i.nickname)}”` : i.known ? 'name not recorded' : 'not identified'}</b>${conf(i.confidence)}</div>
      <div class="id-grid">${row('Serial', i.serial && esc(i.serial))}${row('Bomb Group', esc(i.unit ?? i.group ?? '?'))}${row('Squadron', i.squadron && esc(i.squadron))}${row('Code', i.code && esc(i.code))}
      ${row('Pilot', i.pilot && esc(i.pilot))}${row('That day', OUT[i.outcome ?? 'unknown'] ?? esc(i.outcome))}${row('Mission', 'Schweinfurt, 14 October 1943')}${row('Her place', i.slotDocumented ? (i.slotBasis ? 'as charted' : 'as recorded') : 'not documented: an estimate')}</div>
      ${i.lossDetails ? `<p class="id-note">${esc(i.lossDetails)}${i.macr ? ` (MACR ${esc(i.macr)})` : ''}</p>` : ''}
      <div class="id-crew">${(d.crew ?? []).map((m) => `<div><span>${esc(m.title)}</span><b>${esc(m.name)}${m.placeholder ? ' <i class="unk">placeholder</i>' : ''}</b>${m.placeholder ? '' : `${conf(m.confidence)}<em>${esc(m.fate ?? '')}</em>`}</div>`).join('')}</div>
      <p class="id-foot">${i.known ? 'From the bomb group records (historical_data/black_thursday).' : 'No record of this aircraft has been found: its crew are placeholders, not real men.'} <kbd>I</kbd> to close</p>`;
    el.style.display = 'block';
  }

  /** The screen's edges flash red: you've been hit (k 0..1, how hard). */
  hitFlash(k = 1) {
    const f = this.el('hitflash');
    f.style.setProperty('--k', String(0.35 + k * 0.65));
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  }

  /** First-aid progress (0..1), or null to hide. */
  aid(progress) {
    this.el('aid').style.display = progress == null ? 'none' : 'block';
    if (progress != null) this.el('aid-bar').style.width = `${progress * 100}%`;
  }

  /** You're wounded: the screen blurs and darkens as time runs out. left = seconds, null = fine. */
  hurt(left, total, helped) {
    const canvas = document.querySelector('canvas');
    if (left == null) {
      if (this.hurtOn) { canvas.style.filter = ''; this.el('hurt').style.display = 'none'; this.hurtOn = false; }
      return;
    }
    const k = 1 - left / total;
    canvas.style.filter = `blur(${1.5 + k * 5}px) brightness(${0.75 - k * 0.45}) saturate(${0.7 - k * 0.5})`;
    this.el('hurt').style.display = 'flex';
    this.el('hurt').style.opacity = 0.5 + k * 0.5;
    this.el('hurt-text').textContent = `You're hit! ${helped ? 'Help is on the way' : 'Nobody can reach you'}… ${Math.ceil(left)}s`;
    this.hurtOn = true;
  }

  /** Flash the hit marker round the crosshair: white for a hit, red for the killing blow. */
  hitMarker(kill) {
    const m = this.el('hitmarker');
    m.className = '';
    void m.offsetWidth; // restart the animation
    m.className = kill ? 'kill' : 'hit';
  }

  kill(count) { this.el('kills').textContent = `Kills ${count}`; } // (the banner announces it)

  /**
   * War Thunder style banner across the upper middle: kind 'kill' | 'assist' | 'crit', the aircraft
   * type, the points. Fades after ~3 s; several stack.
   */
  banner(kind, name, points) {
    const head = { kill: 'Aircraft destroyed', assist: 'Kill assist', crit: 'Critical hit' }[kind];
    const badge = /109/.test(name) ? EMBLEM.bf109() : /190/.test(name) ? EMBLEM.fw190() : /47/.test(name) ? EMBLEM.p47() : EMBLEM.crew();
    const b = document.createElement('div');
    b.className = `banner ${kind}`;
    b.innerHTML = `<span class="b-emb">${badge}</span><span class="b-txt"><span class="head">${head}</span><span class="sub">${name}</span></span><span class="pts">+${points}</span>`;
    const box = this.el('banners');
    box.prepend(b);
    while (box.children.length > 4) box.lastChild.remove();
    setTimeout(() => b.classList.add('out'), kind === 'crit' ? 1800 : 2800);
    setTimeout(() => b.remove(), kind === 'crit' ? 2400 : 3400);
  }

  /** Your current life on the HUD: kills, assists, hits. */
  lifeStats(s) {
    const html = `<b>${s.kills + s.bombers}</b> kills · <b>${s.assists}</b> assists · <b>${s.hits}</b> hits`;
    if (html !== this.lastLife) this.el('lifestats').innerHTML = this.lastLife = html;
  }

  /** A life's service record: on the eject / death screens, the parachute view and the debrief. */
  lifeCard(s, title = 'This sortie') {
    const acc = s.fired ? ((100 * s.hits) / s.fired).toFixed(1) : '0.0';
    const cell = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
    return `<div class="record"><div class="rec-head"><span>Service record</span><b>${title}</b></div><div class="rec-grid">
      ${cell('Kills', s.kills)}${s.role === 'bf109' || s.role === 'fw190' ? cell('B-17s', s.bombers) : ''}${cell('Assists', s.assists)}${cell('Crits', s.crits)}
      ${cell('Hits', `${s.hits}<small> / ${s.fired}</small>`)}${cell('Accuracy', `${acc}<small>%</small>`)}${cell('Damage', s.damage)}${cell('Time alive', mmss(s.time))}
      </div><div class="rec-score"><span>Score</span><b>${s.points.toLocaleString()}</b></div></div>`;
  }

  /** The parachute view: the life card in a corner, and when you can go again. */
  ejected(card, ready) {
    const el = this.el('ejectcard');
    el.style.display = card ? 'block' : 'none';
    if (card && card !== this.lastCard) el.innerHTML = this.lastCard = card;
    this.hint(card ? (ready ? 'Click to fly again' : 'Bailed out · click to skip') : '');
  }

  /**
   * Something that happened (a crew call, a phase of the mission, a collision): kept for the mission
   * map (M) rather than popped up, so the only pop-ups in play are kills, assists, crits and your death.
   */
  log(text) {
    (this.events ??= []).push({ text, t: performance.now() });
    if (this.events.length > 6) this.events.shift();
  }

  /**
   * The mission map, held open with M: a 1943 briefing map of the route out from England to the target
   * town, the initial point, the flak belt, the rally, the bomber stream (you in yellow), fighters near
   * you, and the town itself in a corner. `d` = Mission.mapData plus where everyone is; null closes it.
   */
  missionMap(d) {
    const box = this.el('mmap');
    box.style.display = d ? 'flex' : 'none';
    if (!d) return;
    const cv = this.el('mmap-canvas'), g = cv.getContext('2d'), W = cv.width;
    // the whole route on it, the turn for home and all (north up: the way we fly in is up the map)
    const xs = d.route.map((p) => p[0]), zs = d.route.map((p) => p[1]);
    const x0 = Math.min(...xs, -3500), x1 = Math.max(...xs, 3500), z0 = Math.min(...zs) - 1500, z1 = Math.max(...zs) + 1500;
    const span = Math.max(x1 - x0, z1 - z0) + 2000, sc = (W - 60) / span, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const P = ([x, z]) => [W / 2 + (x - cx) * sc, W / 2 + 10 + (z - cz) * sc];
    const INK = '#3b2f22', RED = '#a3271c';
    g.fillStyle = '#e8dcbc'; g.fillRect(0, 0, W, W);
    g.strokeStyle = '#cdbf9a'; g.lineWidth = 1; // the grid, 5 km squares
    for (let k = Math.floor((cz - span) / 5000) * 5000; k < cz + span; k += 5000) { const y = P([0, k])[1]; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    for (let k = Math.floor((cx - span) / 5000) * 5000; k < cx + span; k += 5000) { const x = P([k, 0])[0]; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, W); g.stroke(); }
    g.font = '13px "Courier New", monospace'; g.textBaseline = 'middle';
    const label = (t, [x, y], col = INK, dx = 12) => { g.fillStyle = col; g.fillText(t, x + dx, y); };
    // the flak belt, hatched
    const fy0 = P([0, d.flak[0]])[1], fy1 = P([0, d.flak[1]])[1], fx = 3500 * sc, fc = P([0, 0])[0]; // (round the target)
    g.save(); g.beginPath(); g.rect(fc - fx, fy1, fx * 2, fy0 - fy1); g.clip();
    g.strokeStyle = '#8f8070'; g.lineWidth = 1;
    for (let k = -W; k < W * 2; k += 9) { g.beginPath(); g.moveTo(k, fy1); g.lineTo(k + (fy0 - fy1), fy0); g.stroke(); }
    g.restore();
    g.strokeStyle = '#6d5f50'; g.setLineDash([4, 3]); g.strokeRect(fc - fx, fy1, fx * 2, fy0 - fy1); g.setLineDash([]);
    label('FLAK', [fc - fx, (fy0 + fy1) / 2], '#5d5045', -44);
    // the route: in from the coast, the initial point, the target, the rally and home
    g.strokeStyle = RED; g.lineWidth = 3; g.beginPath();
    g.lineJoin = 'round';
    d.route.forEach((p, i) => g[i ? 'lineTo' : 'moveTo'](...P(p))); g.stroke();
    for (const [name, at] of [['FROM ENGLAND', [0, d.start]], ['I.P.', [0, d.ip]], ['RALLY', d.rally], ['HOME', d.home]]) {
      const p = P(at); g.fillStyle = RED; g.beginPath(); g.arc(p[0], p[1], 5, 0, 7); g.fill(); label(name, name === 'RALLY' ? [p[0], p[1] + 14] : p, RED, name === 'RALLY' ? -66 : 12); // (the rally's just past the target: its name below-left, clear of TARGET)
    }
    // the turn's arrow: which way round it goes
    const k = Math.floor(d.route.length / 2), a = P(d.route[k - 1]), b = P(d.route[k + 1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]), m = P(d.route[k]);
    g.fillStyle = RED; g.beginPath(); g.moveTo(m[0] + Math.cos(ang) * 9, m[1] + Math.sin(ang) * 9);
    g.lineTo(m[0] + Math.cos(ang + 2.5) * 8, m[1] + Math.sin(ang + 2.5) * 8); g.lineTo(m[0] + Math.cos(ang - 2.5) * 8, m[1] + Math.sin(ang - 2.5) * 8); g.fill();
    // the target town: a ringed square
    const t = P([0, 0]), half = (d.city.size / 2) * sc;
    g.fillStyle = '#9b8f7a'; g.fillRect(t[0] - half, t[1] - half, half * 2, half * 2);
    g.strokeStyle = RED; g.lineWidth = 2;
    for (const r of [10, 18]) { g.beginPath(); g.arc(t[0], t[1], r, 0, 7); g.stroke(); }
    label('TARGET', t, RED, 24);
    // the bomber stream, fighters near you, and you
    g.fillStyle = '#2d3a55';
    for (const b of d.bombers) { const p = P(b); g.fillRect(p[0] - 1.5, p[1] - 1.5, 3, 3); }
    for (const f of d.fighters) {
      const p = P(f.at); g.fillStyle = f.side === 'axis' ? '#c0281c' : '#1d5fc0';
      g.beginPath(); g.arc(p[0], p[1], 2.2, 0, 7); g.fill();
    }
    if (d.self) {
      const p = P(d.self); g.fillStyle = '#e8b400'; g.strokeStyle = INK; g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(p[0], p[1] - 8); g.lineTo(p[0] + 6, p[1] + 6); g.lineTo(p[0] - 6, p[1] + 6); g.closePath(); g.fill(); g.stroke();
      label('YOU', p, INK, 10);
    }
    this.townInset(g, d, W);
    g.strokeStyle = INK; g.lineWidth = 2; g.strokeRect(1, 1, W - 2, W - 2);
    g.fillStyle = INK; g.font = 'bold 15px "Courier New", monospace'; g.fillText('MISSION MAP  ·  SECRET', 14, 18);
    const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    const now = performance.now();
    const log = (this.events ?? []).slice().reverse().map((e) => `<div class="ev">${mmss((now - e.t) / 1000)} ago · ${e.text}</div>`).join('');
    this.el('mmap-side').innerHTML = `<h3>${d.phase}</h3>
      <div>${d.toTarget != null ? `Target in <b>${mmss(d.toTarget)}</b>` : 'Target behind us'}</div>
      <div>Town wrecked: <b>${Math.round((d.wrecked / d.buildings) * 100)}%</b> (${d.wrecked} buildings)</div>
      <div class="key"><i style="background:#e8b400"></i>You <i style="background:#2d3a55"></i>B-17s <i style="background:#1d5fc0"></i>P-47s <i style="background:#c0281c"></i>Luftwaffe</div>
      <h4>Log</h4>${log || '<div class="ev">Nothing yet</div>'}
      <div class="hold">Let go of M to close</div>`;
  }

  /** The target town, enlarged in the map's corner: the works, the rail yard, the river, the old town. */
  townInset(g, d, W) {
    const c = d.city, S = 210, x0 = W - S - 14, y0 = W - S - 14, k = S / c.size;
    const P = (x, z) => [x0 + (x + c.size / 2) * k, y0 + (z + c.size / 2) * k];
    g.fillStyle = '#ddd0ad'; g.fillRect(x0, y0, S, S);
    g.fillStyle = '#b5a88c'; g.fillRect(...P(-c.size / 2, c.rail.z0), S, (c.rail.z1 - c.rail.z0) * k);
    g.fillStyle = '#a3967c'; g.beginPath(); g.arc(...P(c.oldTown.x, c.oldTown.z), c.oldTown.r * k, 0, 7); g.fill();
    g.strokeStyle = '#6f8a99'; g.lineWidth = c.riverW * k; g.beginPath();
    for (let x = -c.size / 2; x <= c.size / 2; x += 40) g[x === -c.size / 2 ? 'moveTo' : 'lineTo'](...P(x, c.riverZ(x)));
    g.stroke();
    const f = c.factory;
    g.fillStyle = '#8d3a2c'; g.fillRect(...P(f.x0, f.z0), (f.x1 - f.x0) * k, (f.z1 - f.z0) * k);
    const a = P(0, 0);
    g.strokeStyle = '#a3271c'; g.lineWidth = 1.5;
    g.beginPath(); g.arc(a[0], a[1], 8, 0, 7); g.moveTo(a[0] - 12, a[1]); g.lineTo(a[0] + 12, a[1]); g.moveTo(a[0], a[1] - 12); g.lineTo(a[0], a[1] + 12); g.stroke();
    g.fillStyle = '#3b2f22'; g.font = '11px "Courier New", monospace';
    g.fillText('AIMING POINT: BALL-BEARING WORKS', x0 + 6, y0 + 12);
    g.fillText('OLD TOWN', ...P(c.oldTown.x - 120, c.oldTown.z));
    g.fillText('RAIL YARD', ...P(-1100, c.rail.z1 + 60));
    g.strokeStyle = '#3b2f22'; g.lineWidth = 1; g.strokeRect(x0, y0, S, S);
  }

  /** Short pop-up message (only for your own death now). */
  /** The line being said on the intercom, under the middle of the screen while it's said (null: nothing). */
  caption(who, text) {
    if (!text && !this.capOn) return;
    let c = document.getElementById('radio-cap');
    if (!c) { c = document.createElement('div'); c.id = 'radio-cap'; document.body.append(c); }
    this.capOn = !!text;
    if (!text) { c.classList.remove('on'); return; }
    c.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = who;
    c.append(b, text);
    c.classList.add('on');
  }

  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el('toasts').append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  /**
   * The sound controls: a mute button and a volume line on every menu's top bar and in the settings (kept
   * in step), and the mix in the settings (guns, engines, battle, crew), all remembered between games.
   * onChange(volume 0..1, muted, mix) is called now and whenever they change. N mutes too.
   */
  sound(onChange) {
    let vol = 1, muted = false, mix = { guns: 1, engines: 1, battle: 1, crew: 1, ui: 0.8 };
    try { const s = JSON.parse(localStorage.getItem('bomber.sound') ?? 'null'); if (s) { ({ vol, muted } = s); mix = { ...mix, ...s.mix }; } } catch { /* (no storage: defaults) */ }
    const sets = [['snd-mute', 'snd-vol', 'snd-val'], ['snd-mute-top', 'snd-vol-top', 'snd-val-top']].map((ids) => ids.map((i) => this.el(i)));
    const mixers = [...document.querySelectorAll('[data-mix]')];
    const apply = () => {
      const off = muted || vol === 0;
      for (const [btn, slider, val] of sets) {
        btn.innerHTML = off ? ICON.muted : ICON.sound;
        btn.classList.toggle('off', off);
        btn.setAttribute('aria-pressed', String(muted));
        slider.value = Math.round(vol * 100);
        val.textContent = muted ? 'off' : `${Math.round(vol * 100)}%`;
      }
      for (const m of mixers) { m.value = Math.round(mix[m.dataset.mix] * 100); document.querySelector(`[data-mix-val="${m.dataset.mix}"]`).textContent = `${m.value}%`; }
      try { localStorage.setItem('bomber.sound', JSON.stringify({ vol, muted, mix })); } catch { /* (not remembered) */ }
      onChange(vol, muted, mix);
    };
    for (const [btn, slider] of sets) {
      btn.addEventListener('click', () => { muted = !muted; apply(); });
      slider.addEventListener('input', () => { vol = slider.value / 100; if (vol > 0) muted = false; apply(); });
    }
    for (const m of mixers) m.addEventListener('input', () => { mix[m.dataset.mix] = m.value / 100; apply(); });
    addEventListener('keydown', (e) => {
      if (e.code !== 'KeyN' || e.repeat || e.target.matches?.('input, select')) return;
      muted = !muted; apply();
      if (this.el('hud').style.display === 'block') this.toast(muted ? 'Sound off (N)' : 'Sound on (N)');
    });
    apply();
  }

  /** Full screen: the buttons on the menus and in the settings, and Alt+Enter; kept in step when the browser leaves it itself (Esc). */
  fullscreen() {
    const on = () => !!document.fullscreenElement;
    const toggle = () => { try { on() ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: 'hide' })?.catch?.(() => {}); } catch { /* (not allowed here) */ } };
    // Esc is the game's (pause), not the browser's: in full screen the page keeps the key (Chrome, Edge),
    // so pausing doesn't drop you out of it. Holding Esc down still leaves full screen, as browsers insist.
    const keep = () => { try { if (on()) navigator.keyboard?.lock?.(['Escape'])?.catch?.(() => {}); else navigator.keyboard?.unlock?.(); } catch { /* (not supported) */ } };
    document.addEventListener('fullscreenchange', keep);
    const show = () => { for (const b of document.querySelectorAll('[data-fs]')) { const t = on() ? 'Exit full screen' : 'Full screen'; const s = b.querySelector('span'); if (s) s.textContent = t; else b.textContent = t; b.classList.toggle('on', on()); } };
    for (const b of document.querySelectorAll('[data-fs]')) b.addEventListener('click', toggle);
    addEventListener('keydown', (e) => { if (e.code === 'Enter' && e.altKey && !e.repeat) { e.preventDefault(); toggle(); } });
    document.addEventListener('fullscreenchange', show);
    show();
    // back from a mission (the page reloads, and the browser drops full screen with it): full screen again at
    // your first click or key on the menu (browsers only allow it on one)
    let back = false;
    try { back = sessionStorage.getItem('bomber.fs') === '1'; sessionStorage.removeItem('bomber.fs'); } catch { /* (no storage) */ }
    if (back) {
      const again = (e) => {
        removeEventListener('pointerdown', again, true); removeEventListener('keydown', again, true);
        if (!on() && !e.target?.closest?.('[data-fs]')) toggle();
      };
      addEventListener('pointerdown', again, true); addEventListener('keydown', again, true);
    }
  }

  /** The time of day, season and weather selects: env is changed in place, onChange(env, 'settings') on every change. */
  envControls(env, onChange) {
    this.envSelects = () => { for (const s of document.querySelectorAll('[data-env]')) s.value = env[s.dataset.env]; };
    for (const s of document.querySelectorAll('[data-env]')) s.onchange = () => { env[s.dataset.env] = s.value; onChange(env, 'settings'); };
    this.envSelects();
  }

  /**
   * The start menu's Mission conditions: Default (autumn, day, clear), Choose (the three pickers) or Random
   * (what this mission rolled). onMode(mode) when the mode changes, onPick(key, value) when Choose's pickers do.
   */
  conditions(mode, env, onMode, onPick) {
    const box = this.el('menu-cond');
    const show = () => {
      box.dataset.mode = mode;
      for (const b of box.querySelectorAll('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
      for (const s of box.querySelectorAll('[data-cond]')) s.value = env[s.dataset.cond];
      box.querySelector('.cond-note').textContent = mode === 'random' ? `This mission: ${envLabel(env)}` : mode === 'default' ? 'Summer · Day · Clear' : '';
      this.envSelects?.();
    };
    for (const b of box.querySelectorAll('[data-mode]')) b.onclick = () => { mode = b.dataset.mode; onMode(mode); show(); };
    for (const s of box.querySelectorAll('[data-cond]')) s.onchange = () => { onPick(s.dataset.cond, s.value); show(); };
    this.showConditions = (m) => { if (m) mode = m; show(); };
    show();
  }

  /** The Options switches (markers, distances, lead): remembered between games; onChange(opts) now and on every change. */
  hudOptions(onChange) {
    let o = { enemy: false, friend: false, distance: false, lead: true, plainSight: false, third: false, infinite: false, historical: false, v: 2 };
    try { const saved = JSON.parse(localStorage.getItem('bomber.hud') ?? '{}'); if (saved.v === 2) o = { ...o, ...saved }; } catch { /* (defaults) */ }
    o.third = false; // (every game starts in the cockpit: V switches)
    const boxes = document.querySelectorAll('[data-hud]');
    for (const b of boxes) {
      b.checked = o[b.dataset.hud];
      b.addEventListener('change', () => {
        o[b.dataset.hud] = b.checked;
        try { localStorage.setItem('bomber.hud', JSON.stringify(o)); } catch { /* (not remembered) */ }
        onChange({ ...o });
      });
    }
    onChange({ ...o });
    /** Flip one option from the game (V: the view), kept in step with its box and remembered. */
    this.toggleHud = (k) => {
      o[k] = !o[k];
      for (const b of boxes) if (b.dataset.hud === k) b.checked = o[k];
      try { localStorage.setItem('bomber.hud', JSON.stringify(o)); } catch { /* (not remembered) */ }
      onChange({ ...o });
      return o[k];
    };
  }

  hint(text) {
    this.el('hint').textContent = text;
    this.el('hint').style.display = text ? 'block' : 'none';
  }

  /**
   * The controls for where you are, in a small card at the side: shown for a few seconds whenever that
   * changes (a new station, walking again), then folded to a tag. H opens or folds it.
   */
  controls(rows, key) {
    const el = this.el('controls');
    if (key !== this.ctlKey) {
      this.ctlKey = key;
      el.innerHTML = `<div class="ctl-tag"><b>H</b> controls</div><div class="ctl-rows">${rows.map(([k, what]) => `<div><span>${k.split(' / ').map((x) => `<b>${x}</b>`).join(' ')}</span>${what}</div>`).join('')}</div>`;
      this.ctlOpenUntil = performance.now() + 6000;
    }
    const open = this.ctlPinned ?? performance.now() < this.ctlOpenUntil;
    el.classList.toggle('open', open);
    el.style.display = rows.length ? 'block' : 'none';
  }

  /**
   * The first time somewhere (walking, a gun, the pilot's seat, the sight, a fighter, bailing out): its main
   * keys, big and low in the middle, for a few seconds. Once each, remembered in this browser (so a player
   * back for another go isn't told again). title: what this is; keys: [[key, what]].
   */
  tip(id, title, keys) {
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem('bt-tips') ?? '[]'); } catch { /* (private window: shown each game) */ }
    if ((this.tipsShown ??= new Set()).has(id) || seen.includes(id)) return;
    this.tipsShown.add(id);
    try { localStorage.setItem('bt-tips', JSON.stringify([...seen, id])); } catch { /* (as above) */ }
    const el = this.el('tip');
    el.innerHTML = `<span class="t">${title}</span>${keys.map(([k, what]) => `<span>${k.split(' / ').map((x) => `<b>${x}</b>`).join(' ')}${what}</span>`).join('')}`;
    el.classList.add('on');
    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => el.classList.remove('on'), 9000);
  }

  /** The fighter's lock-on brackets at screen point [x, y] (px), with the range in m; null hides them. */
  lock(at, range = 0) {
    const el = this.el('lock');
    if (!at) { if (el.style.display !== 'none') el.style.display = 'none'; return; }
    el.style.display = 'block'; el.style.left = `${at[0]}px`; el.style.top = `${at[1]}px`;
    const t = `LOCKED · ${Math.round(range / 10) * 10} m`;
    if (el.firstChild.textContent !== t) el.firstChild.textContent = t;
  }

  /** H: open the controls card for good, or fold it away. */
  toggleControls() { this.ctlPinned = !(this.ctlPinned ?? performance.now() < this.ctlOpenUntil); }

  hud({ location, prompt, atStation, looking = false, reflector = false }) {
    this.el('crosshair').style.opacity = reflector ? 0 : looking ? 0.25 : ''; // (a reflector sight in view: its reticle is the aim) // (free-looking: the guns aren't where you look)
    if (location !== this.lastLoc) this.el('location').textContent = this.lastLoc = location;
    if (prompt !== this.lastPrompt) {
      this.el('prompt').innerHTML = this.lastPrompt = prompt;
      this.el('prompt').style.opacity = prompt ? 1 : 0;
    }
    this.el('crosshair').className = atStation ? 'gun' : '';
  }

  tick(dt) {
    this.frames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      if (this.showFps) this.el('fps').textContent = `${Math.round(this.frames / this.fpsTime)} fps`;
      this.frames = 0;
      this.fpsTime = 0;
    }
  }
}
