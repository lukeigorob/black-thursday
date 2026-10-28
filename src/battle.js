// How big the battle is: how many bombers fly and how many fighters are in the air. The game is always
// the Large battle; the smaller ones are kept for testing (a link's ?battle=). Read once at start-up.

export const BATTLES = {
  // (axisTotal: the whole mission's Luftwaffe, coming up in waves; 100 of them Fw 190s, fighters.js)
  small: { label: 'Small', wings: 1, axisActive: 50, axisTotal: 270, alliedActive: 10, alliedTotal: 25, gaggle: [8, 14] }, // 54 B-17s
  medium: { label: 'Medium', wings: 3, axisActive: 95, axisTotal: 370, alliedActive: 16, alliedTotal: 40, gaggle: [12, 22] }, // 162 B-17s
  // (Schweinfurt, 14 October 1943: 291 B-17s; six combat wings, the last of them short)
  large: { label: 'Large', wings: 6, bombers: 291, axisActive: 165, axisTotal: 470, alliedActive: 20, alliedTotal: 50, gaggle: [15, 28] },
};
// Always the large battle. (?battle=small or medium in the link: a hidden override, for testing only.)
function pick() {
  const fromLink = new URLSearchParams(location.search).get('battle');
  return BATTLES[fromLink] ? fromLink : 'large';
}

export const battleName = pick();
export const BATTLE = BATTLES[battleName];
