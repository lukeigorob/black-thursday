// How big the battle is: how many bombers fly and how many fighters are in the air. The game is always
// the Large battle; the smaller ones are kept for testing (a link's ?battle=). Read once at start-up.

export const BATTLES = {
  // (axisTotal: the whole mission's Luftwaffe, 100 more than before in every size, about half of those
  // Fw 190s, coming up in more waves)
  small: { label: 'Small', wings: 1, axisActive: 50, axisTotal: 220, alliedActive: 10, alliedTotal: 25, gaggle: [8, 14] }, // 54 B-17s
  medium: { label: 'Medium', wings: 3, axisActive: 95, axisTotal: 320, alliedActive: 16, alliedTotal: 40, gaggle: [12, 22] }, // 162 B-17s
  large: { label: 'Large', wings: 5, axisActive: 165, axisTotal: 420, alliedActive: 20, alliedTotal: 50, gaggle: [15, 28] }, // 270 B-17s
};
// Always the large battle. (?battle=small or medium in the link: a hidden override, for testing only.)
function pick() {
  const fromLink = new URLSearchParams(location.search).get('battle');
  return BATTLES[fromLink] ? fromLink : 'large';
}

export const battleName = pick();
export const BATTLE = BATTLES[battleName];
