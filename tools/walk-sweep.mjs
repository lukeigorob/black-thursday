// Walk every deck of the bomber with the real movement code and report where you can fall through,
// get stuck, or put your body or eye through the hull.
//   npm run build && npm run preview   (in another terminal: serves the game on 127.0.0.1:4173)
//   node tools/walk-sweep.mjs [url]
// Runs a headless Chrome (needs Chrome installed). Writes walk-sweep-report.json next to this script.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.argv[2] ?? 'http://127.0.0.1:4173/?battle=small';
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
if (!CHROME) { console.error('Chrome not found'); process.exit(1); }
const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'sweep-'))}`,
  '--no-first-run', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio', '--window-size=960,540', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
    if (!page) await sleep(200);
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, timeout: 600000 })).result?.result?.value;
  await send('Page.navigate', { url });
  for (let i = 0; i < 150 && !(await evaluate('!!window.game')); i++) await sleep(200);
  await evaluate(`(async () => { await window.game.chooseRole('crew'); await new Promise((r) => setTimeout(r, 1500)); })()`);
  const report = await evaluate('window.game.walkSweep()');
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), 'walk-sweep-report.json'), JSON.stringify(report, null, 1));
  console.log(`${report.starts} spots, ${report.runs} walks, ${report.routes.length} routes: ${report.total} problems`);
  for (const r of report.routes) console.log(`  route ${r}`);
  for (const [k, n] of Object.entries(report.byKind)) console.log(`  ${n} x ${k}`);
  for (const i of report.issues.slice(0, 40)) console.log(`  ${i.kind} at x ${i.x} y ${i.y} z ${i.z} ${i.extra}`);
  ws.close();
  process.exitCode = report.total ? 1 : 0;
} finally {
  chrome.kill();
}
