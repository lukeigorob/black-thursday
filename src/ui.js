// Menus (start / pause with the graphics setting) and the HUD (crosshair, prompts, location, fps).
import { QUALITY } from './graphics.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export class UI {
  constructor() {
    const root = document.getElementById('ui');
    root.innerHTML = `
      <div id="menu" class="menu"><div class="panel">
        <h1 id="menu-title"></h1><p id="menu-text"></p>
        <button id="menu-go"></button>
        <div id="menu-roles" class="roles"></div>
        <p class="browser-note" id="menu-browser">For proper mouse control play in <b>Chrome</b> or <b>Edge</b> at <b>localhost:5173</b>.
          Other windows, like the Claude app's preview pane, don't let a game capture the mouse, so the cursor drifts off the screen.</p>
        <label class="quality">Graphics <select id="menu-quality">
          ${Object.entries(QUALITY).map(([k, q]) => `<option value="${k}">${q.label}</option>`).join('')}
        </select></label>
        <p class="keys">WASD move · Mouse look · E take / leave a position · Left click fire · Right click zoom · R reload · Shift walk faster · Esc pause · F3 fps<br>
          Pilot seat: mouse steers the plane · W / S throttle · A / D roll · 1–4 engine fire bottles<br>
          Fighters: mouse aims where you fly · W / S throttle · A / D roll · Left click guns · V chase / nose view · J bail out</p>
      </div></div>
      <div id="map" class="menu"><div class="panel map-panel">
        <h1 id="map-title"></h1><p id="map-text"></p>
        <div class="map-row">
          <canvas id="map-canvas" width="560" height="560"></canvas>
          <div id="map-side"><p class="muted">Click a bomber on the map.</p></div>
        </div>
        <p class="keys">Mouse wheel zooms · green fit · yellow damaged · red burning · brighter = higher in the stack · ring = where you were</p>
        <div id="map-roles" class="roles small"></div>
      </div></div>
      <div id="hud">
        <div id="crosshair"></div>
        <div id="location"></div>
        <div id="prompt"></div>
        <div id="fps"></div>
        <div id="hint"></div>
        <div id="hitmarker"><i></i><i></i><i></i><i></i></div>
        <div id="mission"></div>
        <div id="sight"><div class="ring"></div><div class="h"></div><div class="v"></div>
          <div id="sight-info"></div></div>
        <div id="crew"></div>
        <div id="health"><span class="lbl">Airframe</span><div class="bar"><i id="health-bar"></i></div><span id="health-pct"></span></div>
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
    addEventListener('keydown', (e) => {
      if (e.code === 'F3') { e.preventDefault(); this.showFps = !this.showFps; this.el('fps').style.display = this.showFps ? 'block' : 'none'; }
    });
  }

  /**
   * Role buttons: crew / bf109 / p51. `into` is the element id; onRole(id) is called with the choice.
   * only: the ids to offer (all three by default).
   */
  roles(into, onRole, only = ['crew', 'bf109', 'p51']) {
    const box = this.el(into);
    if (!onRole) { box.innerHTML = ''; return; }
    const info = {
      crew: ['B-17 crewman', 'Man the guns, fly the bomber, drop the bombs'],
      bf109: ['Bf 109 pilot', 'Luftwaffe: break up the bomber stream'],
      p51: ['P-51 pilot', 'Escort: keep the 109s off the bombers'],
    };
    box.innerHTML = only.map((id) => `<button class="role-btn ${id}" data-role="${id}"><b>${info[id][0]}</b><small>${info[id][1]}</small></button>`).join('');
    for (const b of box.querySelectorAll('button')) b.onclick = () => onRole(b.dataset.role);
  }

  /** Which HUD to show: the bomber's (crew) or the fighter pilot's. */
  setMode(mode) {
    this.el('hud').dataset.mode = mode === 'crew' || mode === 'eject' ? mode : 'fighter';
    if (mode === 'crew') { this.el('gunsight').style.display = 'none'; this.el('flight').style.display = 'none'; }
  }

  /** The fighter pilot's instruments (null hides them). */
  fighter(s) {
    const box = this.el('flight'), nose = this.el('nose'), sight = this.el('gunsight');
    box.style.display = s ? 'block' : 'none';
    sight.style.display = s?.view === 'nose' ? 'block' : 'none';
    this.el('crosshair').style.display = s?.view === 'nose' ? 'none' : '';
    nose.style.display = s?.marker ? 'block' : 'none';
    if (!s) return;
    if (s.marker) { nose.style.left = `${s.marker.x * 100}%`; nose.style.top = `${s.marker.y * 100}%`; }
    const ammo = Object.entries(s.ammo).map(([k, a]) => `<div>${k === 'cannon' ? '20 mm' : 'MG'} <b>${a.n}</b></div>`).join('');
    box.innerHTML = `<div class="lbl">${s.kind}${s.damage ? ` · <span class="warn">${s.damage}</span>` : ''}</div>
      <div><b>${Math.round(s.speed * 3.6)}</b> km/h · <b>${Math.round(s.alt).toLocaleString()}</b> ft</div>
      <div class="bar"><i style="width:${s.throttle * 100}%"></i></div><span class="lbl">Throttle ${Math.round(s.throttle * 100)}%</span>
      ${ammo}
      <div class="bar"><i style="width:${Math.min(1, s.heat) * 100}%;background:${s.jammed ? '#ff4a3a' : s.heat > 0.7 ? '#ffa23a' : '#d9d2b8'}"></i></div>
      <span class="lbl">${s.jammed ? 'Guns overheated' : 'Gun heat'}</span>`;
    this.health(s.health, null);
  }

  menu({ title, text, button, onClick, quality, onQuality, roles = null }) {
    this.el('menu-title').textContent = title;
    this.el('menu-text').textContent = text ?? '';
    const go = this.el('menu-go');
    go.textContent = button ?? '';
    go.style.display = button ? '' : 'none';
    go.onclick = onClick;
    const q = this.el('menu-quality');
    q.value = quality;
    q.onchange = () => onQuality(q.value);
    this.roles('menu-roles', roles);
    this.el('menu').style.display = 'flex';
    this.el('hud').style.display = 'none';
  }

  play() {
    this.el('menu').style.display = 'none';
    this.el('map').style.display = 'none';
    this.el('hud').style.display = 'block';
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
   * The formation map: pick any surviving bomber, then any fit AI crewman to take over.
   * crewOf(bomber) -> Crew. onPick(bomber, member) is called with the choice.
   */
  map({ title, text, bombers, crewOf, mine, onPick, onRole }) {
    const box = this.el('map'), cv = this.el('map-canvas'), g = cv.getContext('2d'), side = this.el('map-side');
    this.el('map-title').textContent = title;
    this.el('map-text').textContent = text;
    this.el('menu').style.display = 'none';
    this.el('hud').style.display = 'none';
    box.style.display = 'flex';
    this.roles('map-roles', onRole ? (id) => { box.style.display = 'none'; onRole(id); } : null, ['bf109', 'p51']);
    const live = bombers.filter((b) => !b.down && !b.gone && crewOf(b).members.some((m) => m.state === 'ok'));
    // fit the stream into the canvas, nose up
    const xs = bombers.map((b) => b.base.x), zs = bombers.map((b) => b.base.z), ys = bombers.map((b) => b.base.y);
    const x0 = Math.min(...xs) - 150, x1 = Math.max(...xs) + 150, z0 = Math.min(...zs) - 150, z1 = Math.max(...zs) + 150;
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const fit = Math.min(cv.width / (x1 - x0), cv.height / (z1 - z0));
    // mouse wheel zooms in on the cursor (the stream is long; boxes of bombers bunch up)
    const view = { s: fit * 3, cx: mine.base.x, cz: mine.base.z }; // start zoomed in on where you were
    const px = (b) => [cv.width / 2 + (b.base.x - view.cx) * view.s, cv.height / 2 + (b.base.z - view.cz) * view.s];
    let selected = null;
    const colour = (b) => (b.burning ? '#ff5a3a' : b.deadEngines || b.damaged ? '#ffd36a' : '#8fcf6a');
    cv.onwheel = (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect(), mx = ((e.clientX - r.left) / r.width) * cv.width, my = ((e.clientY - r.top) / r.height) * cv.height;
      const wx = view.cx + (mx - cv.width / 2) / view.s, wz = view.cz + (my - cv.height / 2) / view.s;
      view.s = clamp(view.s * (e.deltaY < 0 ? 1.25 : 0.8), fit, fit * 20);
      view.cx = wx - (mx - cv.width / 2) / view.s;
      view.cz = wz - (my - cv.height / 2) / view.s;
      draw();
    };
    const draw = () => {
      g.fillStyle = '#12160f'; g.fillRect(0, 0, cv.width, cv.height);
      g.strokeStyle = '#ece8dc22';
      for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(0, (i * cv.height) / 8); g.lineTo(cv.width, (i * cv.height) / 8); g.stroke(); }
      g.fillStyle = '#ece8dc66'; g.font = '12px system-ui'; g.fillText('▲ heading', 10, 18);
      for (const b of bombers) {
        if (b.gone) continue;
        const [x, y] = px(b), up = (b.base.y - y0) / Math.max(1, y1 - y0);
        g.globalAlpha = b.down ? 0.25 : 0.45 + up * 0.55;
        g.fillStyle = b.down ? '#777' : colour(b);
        g.beginPath(); g.arc(x, y, live.includes(b) ? 4.5 : 3, 0, 7); g.fill();
      }
      g.globalAlpha = 1;
      for (const [b, c, r] of [[mine, '#ffffff', 9], [selected, '#ffe36a', 8]]) {
        if (!b) continue;
        const [x, y] = px(b);
        g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); g.arc(x, y, r, 0, 7); g.stroke();
      }
    };
    const showSide = (b) => {
      const crew = crewOf(b);
      side.innerHTML = `<h3>${b.label || 'B-17'}</h3><p class="muted">${b.deadEngines ? `${b.deadEngines} engine${b.deadEngines > 1 ? 's' : ''} out` : 'All engines running'}${b.burning ? ', on fire' : ''}</p>` +
        crew.members.map((m, i) => {
          const fit = m.state === 'ok';
          const st = { ok: '', wounded: 'wounded', dead: 'KIA', player: '' }[m.state];
          return `<button class="role" data-i="${i}" ${fit ? '' : 'disabled'}>${m.role.title}<small>${fit ? m.name : st}</small></button>`;
        }).join('');
      for (const btn of side.querySelectorAll('button.role')) {
        btn.onclick = () => { box.style.display = 'none'; onPick(b, crew.members[+btn.dataset.i]); };
      }
    };
    cv.onclick = (e) => {
      const r = cv.getBoundingClientRect(), mx = ((e.clientX - r.left) / r.width) * cv.width, my = ((e.clientY - r.top) / r.height) * cv.height;
      let best = null, bd = 14;
      for (const b of live) { const [x, y] = px(b), d = Math.hypot(x - mx, y - my); if (d < bd) { bd = d; best = b; } }
      if (best) { selected = best; draw(); showSide(best); }
    };
    // start with the nearest fit bomber selected
    selected = live.reduce((a, b) => (!a || b.base.distanceTo(mine.base) < a.base.distanceTo(mine.base) ? b : a), null);
    draw();
    if (selected) showSide(selected); else side.innerHTML = '<p>No bomber has anyone left to take over.</p>';
  }

  mission(text) { if (text !== this.lastMission) this.el('mission').textContent = this.lastMission = text; }

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

  /** End-of-mission debrief. */
  debrief(d, onAgain, onQuality = () => {}, role = 'crew') {
    if (role !== 'crew') return this.pilotDebrief(d, onAgain, onQuality, role);
    const pct = d.dropped ? Math.round((d.onTarget / d.dropped) * 100) : 0;
    const mine = d.playerDropped ? Math.round((d.playerOnTarget / d.playerDropped) * 100) : null;
    const rating = pct > 45 ? 'Excellent' : pct > 30 ? 'Good' : pct > 15 ? 'Fair' : 'Poor';
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    this.menu({ title: 'Mission complete', text: '', button: 'Fly again', onClick: onAgain, quality: this.el('menu-quality').value, onQuality });
    this.el('menu-text').innerHTML = `<table class="debrief">
      ${row('Bombing', `<b>${rating}</b>`)}
      ${row('Bombs within 1,000 ft of the aiming point', `${pct}% of ${d.dropped}`)}
      ${row('Your bombs on target', mine == null ? 'none dropped' : `${mine}% of ${d.playerDropped}`)}
      ${row('Target buildings destroyed', `${d.destroyed} of ${d.buildings}`)}
      ${row('Fighters shot down by you', d.kills.player)}
      ${row('… by your crews\' gunners', d.kills.crew)}
      ${row('… by the escorts', d.kills.escorts)}
      ${row('Escorts lost', d.kills.alliedLost)}
      ${row('B-17s lost', `${d.bombersLost} of ${d.bombers}`)}
      ${row('Crewmen saved by first aid', `${d.saved} (${d.savedByYou} by you)`)}
      ${row('Your crew home safe', `${d.crewHome} of 10`)}
    </table>${this.lifeCard(d.score, `Your whole mission (${d.lives} ${d.lives === 1 ? 'life' : 'lives'})`)}`;
  }

  /** End of the mission as a fighter pilot. */
  pilotDebrief(d, onAgain, onQuality, role) {
    const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
    const p = d.pilot;
    this.menu({ title: role === 'bf109' ? 'Einsatz beendet' : 'Mission complete', text: '', button: 'Fly again', onClick: onAgain, quality: this.el('menu-quality').value, onQuality });
    this.el('menu-text').innerHTML = `<table class="debrief">
      ${role === 'bf109'
        ? row('B-17s you brought down', `<b>${p.bombers}</b>`) + row('P-51s you shot down', p.fighters)
        : row('Bf 109s you shot down', `<b>${p.fighters}</b>`) + row('Attacks you broke up (bombers saved)', p.saved)}
      ${row('Times you were shot down', p.deaths)}
      ${row('B-17s lost', `${d.bombersLost} of ${d.bombers}`)}
      ${row('Bf 109s lost (all)', d.kills.axisLost ?? 0)}
      ${row('P-51s lost (all)', d.kills.alliedLost)}
      ${row('Bombs within 1,000 ft of the aiming point', `${d.dropped ? Math.round((d.onTarget / d.dropped) * 100) : 0}% of ${d.dropped}`)}
    </table>${this.lifeCard(d.score, `Your whole mission (${d.lives} ${d.lives === 1 ? 'life' : 'lives'})`)}`;
  }

  /** Crew list: who's on which gun, who's hit (with time left), who's gone. */
  crew(members) {
    const html = members.map((m) => {
      const s = m.state === 'player' ? '<span class="you">YOU</span>'
        : m.state === 'wounded' ? `<span class="hurt">WOUNDED ${Math.ceil(m.woundLeft)}s</span>`
          : m.state === 'dead' ? '<span class="dead">KIA</span>'
            : m.state === 'bailed' ? '<span class="busy">BAILED OUT</span>'
              : m.task === 'helping' ? '<span class="busy">FIRST AID</span>' : '<span class="ok">●</span>';
      return `<div class="${m.state}">${m.role.title}<b>${s}</b></div>`;
    }).join('');
    if (html !== this.lastCrew) this.el('crew').innerHTML = this.lastCrew = html;
  }

  /** The four engines, numbered as the pilot sees them, plus wing fires. */
  engines(bomber) {
    const label = { ok: '', smoking: 'SMOKING', dead: 'OUT', fire: 'FIRE' };
    let html = bomber.engines.map((e, i) => `<span class="eng ${e.state}">${i + 1}<small>${label[e.state]}</small></span>`).join('');
    if (bomber.tankFire[-1] || bomber.tankFire[1]) html += '<span class="eng fire wing">WING FIRE</span>';
    if (bomber.down) html += '<span class="eng fire wing">GOING DOWN</span>';
    if (html !== this.lastEng) this.el('engines').innerHTML = this.lastEng = html;
  }

  /** The airframe health bar (0..1) and the fire bottles left. */
  health(h, bottles) {
    const pct = Math.round(h * 100);
    if (pct === this.lastHealth && bottles === this.lastBottles) return;
    this.lastHealth = pct; this.lastBottles = bottles;
    const bar = this.el('health-bar');
    bar.style.width = `${pct}%`;
    bar.style.background = h > 0.6 ? '#8fcf6a' : h > 0.3 ? '#ffd36a' : '#ff5a3a';
    this.el('health-pct').textContent = bottles == null ? `${pct}%` : `${pct}% · ${bottles} fire bottle${bottles === 1 ? '' : 's'}`;
  }

  /** Flight instruments while you're at the controls (null hides them). */
  flight(f) {
    const box = this.el('flight'), nose = this.el('nose');
    box.style.display = f ? 'block' : 'none';
    nose.style.display = f?.nose ? 'block' : 'none';
    if (!f) return;
    if (f.nose) { nose.style.left = `${f.nose.x * 100}%`; nose.style.top = `${f.nose.y * 100}%`; }
    box.innerHTML = `<div><b>${Math.round(f.mph)}</b> mph</div><div><b>${Math.round(f.feet).toLocaleString()}</b> ft</div>
      <div>Heading <b>${Math.round(f.heading).toString().padStart(3, '0')}°</b> · bank ${Math.round(f.bank)}°</div>
      <div class="bar"><i style="width:${f.throttle * 100}%"></i></div><span class="lbl">Throttle ${Math.round(f.throttle * 100)}%</span>
      <div class="lbl">${f.offset > 60 ? `${Math.round(f.offset)} m out of formation` : 'In formation'}</div>`;
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
    const head = { kill: 'AIRCRAFT SHOT DOWN', assist: `ASSIST: ${name}`, crit: 'CRITICAL DAMAGE' }[kind];
    const b = document.createElement('div');
    b.className = `banner ${kind}`;
    b.innerHTML = `<div class="head">${head}</div><div class="sub">${kind === 'assist' ? '' : name}<span class="pts">+${points}</span></div>`;
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

  /** A life's summary: on the eject / death screens (and the parachute view). */
  lifeCard(s, title = 'This sortie') {
    const mm = Math.floor(s.time / 60), ss = Math.floor(s.time % 60).toString().padStart(2, '0');
    const acc = s.fired ? ((100 * s.hits) / s.fired).toFixed(1) : '0.0';
    return `<div class="lifecard"><div class="lbl">${title}</div><table>
      <tr><td>Kills</td><td>${s.kills}</td>${s.role === 'bf109' ? `<td>B-17s</td><td>${s.bombers}</td>` : '<td></td><td></td>'}</tr>
      <tr><td>Assists</td><td>${s.assists}</td><td>Crits</td><td>${s.crits}</td></tr>
      <tr><td>Hits</td><td>${s.hits} / ${s.fired}</td><td>Accuracy</td><td>${acc}%</td></tr>
      <tr><td>Damage</td><td>${s.damage}</td><td>Time alive</td><td>${mm}:${ss}</td></tr>
      <tr><td>Score</td><td colspan="3"><b>${s.points}</b></td></tr></table></div>`;
  }

  /** The parachute view: the life card in a corner, and when you can go again. */
  ejected(card, ready) {
    const el = this.el('ejectcard');
    el.style.display = card ? 'block' : 'none';
    if (card && card !== this.lastCard) el.innerHTML = this.lastCard = card;
    this.hint(card ? (ready ? 'Click to fly again' : 'Bailed out · click to skip') : '');
  }

  /** Short message, e.g. a crew callout. */
  toast(text, kind = '') {
    const t = document.createElement('div');
    t.className = `toast ${kind}`;
    t.textContent = text;
    this.el('toasts').append(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  hint(text) {
    this.el('hint').textContent = text;
    this.el('hint').style.display = text ? 'block' : 'none';
  }

  hud({ location, prompt, atStation }) {
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
