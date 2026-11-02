// The scenario being flown: the Schweinfurt raid (none of these: the default), or one of the smaller fights
// picked from the menu. Read once at start-up from the link (?scenario=duel&me=bf109&foe=p47&start=merge&
// skill=veteran), as battle.js reads ?battle=, because a restart is a reload: everything that depends on it
// (the bomber stream, the air's speed past the formation, who's in the air) is set up from it at load.

export const SCENARIOS = {
  duel: { label: 'Duel', blurb: 'You against one of them. A straight fight, fighter on fighter.', friends: 0, foes: 1 },
  pair: { label: 'Two against two', blurb: 'You and your wingman against a pair. Stay together: one fights, the other covers.', friends: 1, foes: 2 },
  outnumbered: { label: 'Outnumbered', blurb: 'Alone against a pair. Keep your speed, pick your moment, don\'t get caught turning.', friends: 0, foes: 2 },
  hold: { label: 'Hold them off', blurb: 'You and your wingman against four. Survive, and take as many with you as you can.', friends: 1, foes: 4 },
  intercept: { label: 'Bomber intercept', blurb: 'A box of six B-17s and a light escort. The raid in miniature.', bombers: 6, raid: true },
};

export const PLANES = { bf109: 'Bf 109 F', fw190: 'Fw 190 A-8', p47: 'P-47D Thunderbolt' };
export const SIDE = { bf109: 'axis', fw190: 'axis', p47: 'allied' };
export const STARTS = {
  merge: { label: 'Head-on', blurb: 'Nose to nose, level, 3 km apart: the merge.' },
  advantage: { label: 'You bounce them', blurb: 'You start above and behind them, with the speed to use it.' },
  bounced: { label: 'You\'re bounced', blurb: 'They start above and behind you. Break!' },
};
export const SKILLS = {
  // react: s before he sees and answers a change; aim: how far his sight wanders (x the pilots' usual);
  // g: the most he'll pull; lead: how well he judges deflection (1 = right on)
  rookie: { label: 'Rookie', react: 0.9, aim: 1.8, g: 4.5, lead: 0.6 },
  veteran: { label: 'Veteran', react: 0.45, aim: 1.0, g: 6, lead: 0.85 },
  ace: { label: 'Ace', react: 0.2, aim: 0.55, g: 6.8, lead: 1 },
};

/** The opposing type a plane meets by default: the Thunderbolt meets the 109; a German meets the Thunderbolt. */
export const defaultFoe = (me) => (SIDE[me] === 'allied' ? 'bf109' : 'p47');

function read() {
  if (typeof location === 'undefined') return null; // (no page: a test in node)
  const q = new URLSearchParams(location.search), id = q.get('scenario');
  const def = SCENARIOS[id];
  if (!def) return null;
  const me = PLANES[q.get('me')] ? q.get('me') : 'p47';
  let foe = PLANES[q.get('foe')] ? q.get('foe') : defaultFoe(me);
  if (SIDE[foe] === SIDE[me]) foe = defaultFoe(me); // (the other side's: there are no fights among friends)
  const start = STARTS[q.get('start')] ? q.get('start') : 'merge';
  const skill = SKILLS[q.get('skill')] ? q.get('skill') : 'veteran';
  return { id, ...def, me, foe, start, skill, side: SIDE[me], dogfight: !def.raid };
}

export const SCENARIO = read();

/** The link that starts scenario `id` with these choices (the page reloads into it). */
export function scenarioLink({ id, me, foe, start, skill }) {
  const q = new URLSearchParams({ scenario: id, me, foe, start, skill });
  return `${location.pathname}?${q}`;
}
