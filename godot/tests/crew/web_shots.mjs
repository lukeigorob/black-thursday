// The web game's side of tests/crew/crew_test.gd: the same moments, the same views, at 1920x1080.
//   (build and serve the web game on your own port first: see PORTING.md)
//   node godot/tests/crew/web_shots.mjs http://127.0.0.1:<port>/ <out folder> [cdp port]
// Writes <out>/web_<moment>.png beside the Godot test's crew_<moment>.png.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/';
const OUT = process.argv[3] ?? '.';
const PORT = +(process.argv[4] ?? 9473);
mkdirSync(OUT, { recursive: true });
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].find(existsSync);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'crewshots-'))}`,
  '--no-first-run', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
try {
  let page;
  for (let i = 0; i < 80 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
    if (!page) await sleep(250);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 600000 });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 600));
    return r.result?.result?.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `web_${name}.png`), Buffer.from(r.result.data, 'base64'));
    console.log('SHOT', name);
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  for (let i = 0; i < 600 && !(await ev('!!(window.game && game.bomber && game.bomber.interior && game.crew)')); i++) await sleep(500);
  await sleep(2000);
  // aboard as the radio operator, the HUD out of the way (the Godot test has none)
  await ev(`(async () => {
    const g = window.game;
    g.takeSeat(g.bomber, g.crew.member('radio'));
    await new Promise((r) => setTimeout(r, 1500));
    for (const el of document.querySelectorAll('body > div, #hud, .hud, #ui')) if (!el.querySelector('canvas') && el.tagName !== 'CANVAS') el.style.visibility = 'hidden';
    window.__wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
    window.__station = (id) => g.player.it.stations.find((s) => s.id === id);
    window.__place = (f, yaw, pitch = 0) => { g.player.detachAll(); g.player.becomes(new g.THREE.Vector3(...f), yaw); g.player.pitch = pitch; };
    window.__take = (id) => { const s = __station(id); g.player.becomes(s.stand, s.yaw); g.player.near = s; g.player.passage = null; g.player.interact(); };
    window.__walkTo = (t, limit = 12) => new Promise((res) => {
      const p = g.player, t0 = performance.now();
      const step = () => {
        if (Math.hypot(t[0] - p.feet.x, t[2] - p.feet.z) <= 0.22 || performance.now() - t0 > limit * 1000) { p.keys = {}; res(); return; }
        p.yaw = Math.atan2(-(t[0] - p.feet.x), -(t[2] - p.feet.z)); p.pitch = 0; p.keys = { KeyW: true };
        requestAnimationFrame(step);
      };
      step();
    });
  })()`);
  await ev('__wait(1.5)');
  await shot('01_radio_room');
  await ev('__place([0, -1.95, -0.9], Math.PI, -0.08); __wait(0.8)');
  await shot('02_waist');
  const CORRIDOR = await ev('(() => { const c = [[0, -0.72, -9.75], [0, -0.72, -8.95], [0, -1.0, -8.55], [0, -1.0, -7.62], [0, -0.40, -7.5], [0, -0.40, -6.6], [0, -0.72, -6.22], [0, -1.02, -5.97], [0, -1.32, -5.72], [0, -1.62, -5.4], [0, -1.62, -2.75], [0, -1.80, -2.45], [0, -1.80, -1.4], [0, -1.95, -1.05], [0.6, -1.95, -0.7], [0.6, -1.95, 0.4], [0, -1.95, 0.8], [0, -1.95, 5.0], [0, -2.15, 5.4], [0, -2.15, 8.0], [0, -2.32, 8.4], [0, -2.32, 9.5]]; return c; })()');
  await ev(`__place(${JSON.stringify(CORRIDOR[0])}, 0); __wait(0.4)`);
  await shot('03_nose');
  const shots = { 4: '04_under_flight_deck', 9: '05_bomb_bay', 13: '06_into_waist', 17: '07_tail_bulkhead' };
  const t0 = Date.now();
  for (let i = 1; i < CORRIDOR.length; i++) {
    await ev(`__walkTo(${JSON.stringify(CORRIDOR[i])})`);
    if (shots[i]) await shot(shots[i]);
  }
  console.log('walk nose to tail', ((Date.now() - t0) / 1000).toFixed(1), 's');
  const stations = await ev('game.player.it.stations.map((s) => [s.id, !!s.entry])');
  for (const [sid, entry] of stations) {
    await ev(`__take('${sid}'); __wait(${entry ? 1.6 : 0.9})`);
    await shot(`st_${sid}`);
    await ev('game.player.detachAll()');
  }
  // your own crew from out behind her (the third-person view from the pilot's seat)
  await ev("__take('pilot'); game.player.third = true; __wait(1.4)"); await shot('18_third_person_own_crew');
  await ev('game.player.third = false; game.player.detachAll()');
  // (the crawlway: the passage the player finds standing over it)
  await ev(`(() => { const g = game, P = g.player; P.becomes(new g.THREE.Vector3(0, -0.40, -7.55), 0); P.update(0); if (P.passage) P.startCrawl(P.passage); })()`);
  await ev('__wait(1.9)'); await shot('08_crawl_to_nose'); await ev('__wait(2.4)');
  await ev(`(() => { const g = game, P = g.player; P.becomes(new g.THREE.Vector3(0, -1.95, 4.85), Math.PI); P.update(0); if (P.passage) P.startCrawl(P.passage); })()`);
  await ev('__wait(3.0)'); await shot('09_crawl_to_tail'); await ev('__wait(3.2); game.player.detachAll()');
  await ev(`(async () => { const g = game, P = g.player; P.becomes(new g.THREE.Vector3(0, -1.95, 3.0), 0); await __wait(0.5); P.hurt(1.2, 'torso'); g.crew.findHelper({ player: P }); await __wait(1.2); })()`);
  await shot('10_wounded');
  await ev('__wait(3.0)'); await shot('11_first_aid'); await ev('__wait(5.0)');
  await ev(`(() => { const g = game, P = g.player; P.becomes(new g.THREE.Vector3(0.2, -1.95, 4.0), -Math.PI / 2); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyJ' })); })()`);
  await ev('__wait(0.8)'); await shot('12_hatches_lit');
  await ev(`(async () => { const P = game.player, h = P.hatches?.[0] ?? null; if (!h) return; await __walkTo([h.pos.x, h.pos.y, h.pos.z]); P.startExit(h); })()`);
  await ev('__wait(2.3 * 0.45)'); await shot('13_in_the_door');
  await ev('__wait(2.3 * 0.4)'); await shot('14_going_out');
  await ev('__wait(2.3 * 0.4 + 0.7)'); await shot('15_free_fall');
  await ev('game.eject.pull(); __wait(2.0)');
  await ev('game.eject.pitch = 1.2; __wait(0.6)'); await shot('16_under_the_chute_up');
  await ev('game.eject.pitch = -1.0; __wait(0.4)'); await shot('17_under_the_chute_down');
  ws.close();
} finally {
  chrome.kill();
}
