(async () => {
  const g = window.game, wait = (ms) => new Promise((r) => setTimeout(r, ms)), T = g.THREE;
  await g.chooseRole('crew'); await wait(800);
  document.querySelectorAll('#map-side .crew-row')[g.crew.members.findIndex((m) => m.role.id === 'tail')].click(); await wait(6000);
  const out = [];
  for (const m of g.crew.members) {
    const r = m.fig?.userData.rig; if (!r) continue;
    const wp = (b) => b.getWorldPosition(new T.Vector3()), row = { role: m.role.id, task: m.task, state: m.state, reach: !!r.reach, visible: m.fig.visible };
    if (r.reach) ['l', 'r'].forEach((s, i) => { if (r.free?.[i]) { row[s] = 'free'; return; } const A = r.arms[s], k = m.fig.getWorldScale(new T.Vector3()).x; row[s] = { handToGrip: +wp(A.hand).distanceTo(r.reach[i]).toFixed(3), shoulderToGrip: +wp(A.upper).distanceTo(r.reach[i]).toFixed(3), armLen: +((A.a + A.b) * k).toFixed(3), elbowBend: +wp(A.upper).distanceTo(wp(A.hand)).toFixed(3) }; });
    out.push(row);
  }
  return { out };
})()
