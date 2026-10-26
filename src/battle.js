// How big the battle is: Small / Medium / Large. Set on the start menu (remembered) or in the link
// (?battle=small). It decides how many bombers fly and how many fighters are in the air, so a slower
// computer or browser still runs smoothly. Read once at start-up: changing it reloads the page.

export const BATTLES = {
  // (axisTotal: the whole mission's Luftwaffe, 100 more than before in every size, about half of those
  // Fw 190s, coming up in more waves)
  small: { label: 'Small', wings: 1, axisActive: 50, axisTotal: 220, alliedActive: 10, alliedTotal: 25, gaggle: [8, 14] }, // 54 B-17s
  medium: { label: 'Medium', wings: 3, axisActive: 95, axisTotal: 320, alliedActive: 16, alliedTotal: 40, gaggle: [12, 22] }, // 162 B-17s
  large: { label: 'Large', wings: 5, axisActive: 165, axisTotal: 420, alliedActive: 20, alliedTotal: 50, gaggle: [15, 28] }, // 270 B-17s
};
const KEY = 'bomber.battle';

function pick() {
  const fromLink = new URLSearchParams(location.search).get('battle');
  if (BATTLES[fromLink]) return fromLink;
  try { const saved = localStorage.getItem(KEY); if (BATTLES[saved]) return saved; } catch { /* storage blocked */ }
  return 'medium';
}

export const battleName = pick();
export const BATTLE = BATTLES[battleName];

/** Change the battle size: remembered, and the page reloads to build it. */
export function setBattle(name) {
  try { localStorage.setItem(KEY, name); } catch { /* storage blocked */ }
  const url = new URL(location.href);
  url.searchParams.set('battle', name);
  location.href = url.toString();
}
