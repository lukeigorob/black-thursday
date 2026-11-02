// A guard on the game's memory, so it can never take a computer down. In normal play the page's JavaScript
// heap stays round 200-300 MB (and the audio a few dozen sounds at once); anything well past that means
// something is running away. Checked every two seconds while the game runs:
// - the heap past WARN_MB, or climbing faster than CLIMB_MB a second for 10 s: drop what can be dropped
//   (the decoded voice clips), lower the graphics a step, and say so;
// - the heap past STOP_MB: stop the game (the loop, the sound) and say why, with a button to reload,
//   rather than go on eating the machine's RAM;
// - the sound clock stuck for 5 s while the game wants sound (the output device gone or changed): nothing
//   is made while it's stuck (audio.js steady()), and the context is asked to resume.
// (Chrome and Edge report the heap; other browsers don't, and only the sound checks run there.)
const WARN_MB = 900, STOP_MB = 1600, CLIMB_MB = 40;
const LOWER = { high: 'medium', medium: 'low' };

export class MemGuard {
  constructor({ gfx, audio, ui, stop }) {
    Object.assign(this, { gfx, audio, ui, stop });
    this.last = 0; this.heap = []; this.warned = 0; this.stopped = false; this.stuckSince = 0;
  }

  /** Each frame (cheap: it only looks every two seconds). now: performance.now(); wantSound: the game is on. */
  update(now, wantSound) {
    if (this.stopped || now - this.last < 2000) return;
    this.last = now;
    const mb = performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0;
    if (mb) {
      this.heap.push([now, mb]);
      while (this.heap.length && now - this.heap[0][0] > 10000) this.heap.shift();
      const [t0, m0] = this.heap[0], climb = now - t0 > 8000 ? (mb - m0) / ((now - t0) / 1000) : 0;
      if (mb > STOP_MB) return this.halt(mb);
      if ((mb > WARN_MB || climb > CLIMB_MB) && now - this.warned > 30000) this.ease(mb, climb);
    }
    // the sound clock: running but not moving while the game should be making sound
    const ctx = this.audio.ctx;
    if (wantSound && ctx && ctx.state === 'running' && !this.audio.steady()) {
      this.stuckSince ||= now;
      if (now - this.stuckSince > 5000) { ctx.resume?.(); this.stuckSince = now; }
    } else this.stuckSince = 0;
  }

  ease(mb, climb) {
    this.warned = performance.now();
    this.audio.clips?.clear(); // (the decoded voice lines: fetched again from the disk cache when wanted)
    const lower = LOWER[this.gfx.qualityName];
    if (lower) this.gfx.setQuality(lower);
    console.warn(`memory guard: heap ${mb.toFixed(0)} MB, climbing ${climb.toFixed(0)} MB/s: caches dropped${lower ? ', graphics to ' + lower : ''}`);
    this.ui.toast(`Memory running high: graphics lowered${lower ? ' to ' + lower[0].toUpperCase() + lower.slice(1) : ''} to keep your computer safe`, 'warn');
  }

  halt(mb) {
    this.stopped = true;
    this.stop();
    try { this.audio.ctx?.close(); } catch { /* (already closed) */ } // (frees every sound at once)
    this.audio.clips?.clear();
    console.error(`memory guard: heap ${mb.toFixed(0)} MB: game stopped`);
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:99999;display:grid;place-items:center;background:#16181bee;color:#e9e3d2;font:16px/1.5 system-ui,sans-serif;padding:16px';
    d.innerHTML = `<div style="max-width:560px"><h2 style="margin:0 0 12px;font-size:24px">The game stopped to protect your computer</h2>
      <p>Its memory use climbed far past normal (${(mb / 1024).toFixed(1)} GB), so it has stopped before it could slow down or crash your computer.</p>
      <p>Reload to start again. If it happens again, choose <b>Low</b> graphics in the menu, and close other heavy programs.</p>
      <p><button onclick="location.reload()" style="font:inherit;padding:8px 18px;cursor:pointer">Reload</button></p></div>`;
    document.body.append(d);
  }
}
