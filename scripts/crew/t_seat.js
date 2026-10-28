(async () => {
  // On the flight deck on foot: from where you'd stand, looking left, right, ahead, down, what E takes.
  const g = window.game, wait = (ms) => new Promise((r) => setTimeout(r, ms)), p = g.player;
  await g.chooseRole('crew'); await wait(800);
  document.querySelectorAll('#map-side .crew-row')[g.crew.members.findIndex((m) => m.role.id === 'engineer')].click(); await wait(5000);
  if (p.station) { p.interact(); await wait(1500); } // (out of the turret, on foot)
  const D = Math.PI / 180, out = [];
  const spots = [
    ['behind the seats, looking at pilot seat', [0, -6.95], 20 * D, 0],
    ['behind the seats, looking at co-pilot seat', [0, -6.95], -20 * D, 0],
    ['between the seats, looking left', [0, -7.25], 70 * D, 0],
    ['between the seats, looking right', [0, -7.25], -70 * D, 0],
    ['between the seats, looking ahead and down a little', [0, -7.25], 0, -0.4],
    ['over the crawlway, looking down', [0, -7.5], 0, -0.9],
    ['pilot stand, facing forward', [-0.18, -7.2], 0, -0.2],
    ['co-pilot stand, facing forward', [0.18, -7.2], 0, -0.2],
    ['by the turret, looking aft at it', [0, -7.15], Math.PI, 0],
  ];
  for (const [name, [x, z], yaw, pitch] of spots) {
    p.feet.set(x, p.feet.y, z); p.yaw = yaw; p.pitch = pitch;
    await wait(250);
    out.push(`${name}: ${p.near ? p.near.id : p.passage ? 'crawl: ' + p.passage.name : 'nothing'}`);
  }
  return { out, y: p.feet.y };
})()
