(async () => {
  // Each man's hands at his grips, seen from beside and from above the gun, the bomber and its guns shown
  // (so a forearm inside a receiver shows): the camera ~0.8 m off the middle of his hands.
  const g = window.game, wait = (ms) => new Promise((r) => setTimeout(r, ms)), T = g.THREE;
  await g.chooseRole('crew'); await wait(800);
  document.querySelectorAll('#map-side .crew-row')[g.crew.members.findIndex((m) => m.role.id === 'tail')].click(); await wait(6000);
  const shot = async (n) => { window.__wantShot = n; for (let k = 0; k < 60 && window.__wantShot; k++) await wait(50); };
  const dbg = g.formationDebug;
  for (const o of [dbg.slotPts, dbg.links]) o.visible = false;
  for (const el of document.querySelectorAll('body > div, body > pre')) if (/FORMATION INSPECTION/.test(el.textContent) && el.textContent.length < 20000) el.style.display = 'none';
  let view = null; dbg.frame = () => view; dbg.update = () => {};
  const out = [];
  for (const m of g.crew.members) {
    const r = m.fig?.userData.rig; if (!r?.reach || !m.fig.visible) continue;
    const wp = (b) => b.getWorldPosition(new T.Vector3());
    const hands = wp(r.arms.l.hand).add(wp(r.arms.r.hand)).multiplyScalar(0.5);
    const q = m.fig.getWorldQuaternion(new T.Quaternion());
    for (const [name, dir] of [['side', new T.Vector3(1, 0.35, 0.25)], ['above', new T.Vector3(-0.35, 1.2, 0.5)], ['front', new T.Vector3(0.3, 0.25, -1)], ['back', new T.Vector3(0.25, 0.45, 1.3)]]) {
      const d = dir.normalize().applyQuaternion(q);
      view = { at: hands.clone().addScaledVector(d, 0.75), look: hands };
      await wait(300); await shot(`guns_${m.role.id}_${name}`);
    }
    out.push(m.role.id);
  }
  view = null;
  return { out };
})()
