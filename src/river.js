// The Main at Schweinfurt, in the town's own frame (m, the aiming point at 0, 0): where the town (city.js)
// and the countryside round it (countryside.js: no village in the river) both need it.

/** The river's middle line (z) at x, through the town. */
export const riverZ = (x) => -480 + 90 * Math.sin(x / 380) + 40 * Math.sin(x / 150 + 1);
/** The Main's course out past the town: the town's own river, swinging into wide meanders beyond it. */
export const mainZ = (x) => riverZ(x) + 700 * Math.sin(x / 3600) * Math.min(1, Math.max(0, (Math.abs(x) - 1000) / 1600));
