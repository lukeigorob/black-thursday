// What the crew say on the intercom, and who says it. Shared by the game (radio.js) and the script that
// records the voices (scripts/voices): change a line here, then record them again.
// Few lines, each said only when what it says is really so (radio.js decides when).
// A line: by = who can say it, first choice first (the next one if he's dead, hurt, or you); say = what
// he says; as = other words for a man who'd put it differently (the co-pilot doesn't say "pilot to crew");
// pri = how much it matters (3 = now, before anything waiting); ttl = s it can wait to be said before it's
// stale (a fighter's position goes stale fast); any = whichever of them is free, not the first.
import { CREW_SURNAMES, PILOT_SURNAMES } from './crewnames.js';

// the recorded voices: Chatterbox copying each man from a sample of a Kokoro voice (.voices/ref-all,
// made by scripts/voices/make_refs.py), with some feeling (exaggeration; cfg: pacing). Kept moderate: much
// more and the takes come out overacted, with stray sounds tacked on the end. A line marked calm (radio
// procedure: "your ship", "flak ahead") is said flat and matter-of-fact, whoever says it.
export const VOICES = {
  pilot: { ref: 'am_liam', exaggeration: 0.9, cfg: 0.4 },
  copilot: { ref: 'am_puck+am_echo', exaggeration: 0.9, cfg: 0.4 },
  bombardier: { ref: 'am_puck+am_echo', exaggeration: 1.2, cfg: 0.35 },
  navigator: { ref: 'am_michael', exaggeration: 0.9, cfg: 0.4 },
  engineer: { ref: 'am_echo', exaggeration: 1.2, cfg: 0.35 },
  ball: { ref: 'am_echo', exaggeration: 1.0, cfg: 0.4 },
  waistL: { ref: 'am_michael', exaggeration: 1.2, cfg: 0.35 },
  waistR: { ref: 'am_liam', exaggeration: 1.2, cfg: 0.35 },
  tail: { ref: 'am_fenrir', exaggeration: 1.2, cfg: 0.35 },
};
export const CALM = { exaggeration: 0.35, cfg: 0.5 };

// each man on the intercom (rate: played a touch faster or slower; 1 = as recorded)
export const SPEAKERS = {
  pilot: { label: 'Pilot', voice: 'pilot', rate: 1, deep: true },
  copilot: { label: 'Co-pilot', voice: 'copilot', rate: 1 },
  bombardier: { label: 'Bombardier', voice: 'bombardier', rate: 1 },
  navigator: { label: 'Navigator', voice: 'navigator', rate: 1 },
  engineer: { label: 'Top turret', voice: 'engineer', rate: 1 },
  ball: { label: 'Ball', voice: 'ball', rate: 1 },
  waistL: { label: 'Left waist', voice: 'waistL', rate: 1 },
  waistR: { label: 'Right waist', voice: 'waistR', rate: 1 },
  tail: { label: 'Tail', voice: 'tail', rate: 1 },
};

const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const GUNNERS = ['tail', 'waistL', 'waistR', 'ball', 'engineer', 'bombardier'];

/**
 * Who calls something at `h` o'clock, `level`: the two men who can see it. Behind, the tail gunner;
 * below, the ball turret; ahead, the bombardier; each side, its waist gunner; above, the top turret.
 */
export function clockCallers(h, level) {
  if (h >= 5 && h <= 7) return ['tail', level === 'low' ? 'ball' : level === 'high' ? 'engineer' : h === 5 ? 'waistR' : 'waistL'];
  const side = h >= 11 || h <= 1 ? 'bombardier' : h <= 4 ? 'waistR' : 'waistL';
  return level === 'low' ? ['ball', side] : [side, 'engineer'];
}

// the crew's surnames (crew.js deals them out): the calls of a man hit or killed, and of a Fort under
// attack, say his name, so each is recorded with every name
export const SURNAMES = ['Miller', 'Kowalski', 'Brennan', 'Haskell', 'DeLuca', 'Ostrowski', 'Reyes', 'Lindqvist', 'Murphy', 'Abbott', 'Fischer',
  'Grady', 'Novak', 'Turner', 'Callahan', 'Whitfield', 'Romano', 'Sorensen', 'Jablonski', 'Barlow', 'Dunn', 'Kessler', 'McKay', 'Stroud'];

// (say: the words, or several ways of saying it, one picked each time, never the one said last; gap: s
// before the line is said again, or any line of its group)
export const LINES = {
  // the mission
  km20: { by: ['navigator'], pri: 1, say: ['Navigator to pilot, twenty kilometres to target.', 'Navigator to pilot, target twenty kilometres ahead.'] },
  yourShip: { by: ['pilot'], pri: 2, calm: true, say: 'Pilot to bombardier, your ship.' },
  myShip: { by: ['bombardier'], pri: 2, calm: true, say: 'Bombardier to pilot, my ship.' },
  bombsAway: { by: ['bombardier', 'navigator'], pri: 3, say: ["Bombs away! Let's go home!", 'Bombs away!', "Bombs away! Bomb bay's clear!"] },
  lastOfThem: { by: ['pilot', 'copilot', 'engineer'], pri: 1, say: ["That's the last of them. Let's go home.", "They're turning for home. Keep your eyes open."] },
  // the escort turning back, out of fuel (fighters.js)
  escortsHome: { by: ['pilot', 'copilot'], pri: 2, say: ["Little friends are turning back. We're on our own, boys.", "There go the Thunderbolts. We're on our own from here."] },
  // flak
  flakAhead: { by: ['pilot', 'copilot', 'engineer'], pri: 3, calm: true, say: ['Pilot to crew, flak ahead.', 'Pilot to crew, flak coming up ahead. Stay on your guns.'],
    as: { copilot: ['Flak ahead.', 'Flak coming up ahead. Hang on.'], engineer: ['Flak ahead.', 'Flak coming up ahead. Hang on.'] } },
  flakStopping: { by: ['pilot', 'copilot', 'engineer'], pri: 3, say: ["Flak's stopping. You know what that means, boys. Get ready for fighters.", "Flak's letting up. Watch for fighters."] },
  // the other Forts
  fortsFire: { any: true, by: GUNNERS, pri: 1, gap: 120, say: ['Forts on fire all over the place!', "There's Forts burning everywhere!", "They're getting hit all over the place!"] },
  fortDown: { by: GUNNERS, pri: 2, gap: 60, say: ['Fort going down! Count the chutes!', 'There goes a Fort! Look for chutes!', "Fort's going down!"] },
  giveEmHell: { by: ['pilot', 'copilot'], pri: 1, gap: 180, say: ["Give 'em hell, boys!", 'Keep firing, boys!', 'Stay on your guns!'] },
  // our own bomber burning, as the pilot sees it from his seat
  wingFire_left: { by: ['pilot', 'copilot'], pri: 3, say: ["Left wing's on fire!", 'Fire in the left wing!'] },
  wingFire_right: { by: ['pilot', 'copilot'], pri: 3, say: ["Right wing's on fire!", 'Fire in the right wing!'] },
  // a hole in a wing, called by whoever can see it (once a wing)
  wingHole_left: { by: ['waistL', 'pilot', 'engineer'], pri: 2, say: ["There's a hole in the left wing!", "Left wing's holed! There's a big hole in it!"] },
  wingHole_right: { by: ['waistR', 'copilot', 'engineer'], pri: 2, say: ["There's a hole in the right wing!", "Right wing's holed! There's a big hole in it!"] },
};
for (let n = 1; n <= 4; n++) {
  LINES[`engHit${n}`] = { by: ['pilot', 'copilot'], pri: 3, say: [`Engine ${NUM[n]} is hit!`, `Engine ${NUM[n]}'s hit, she's smoking!`] };
  LINES[`engFire${n}`] = { by: ['pilot', 'copilot'], pri: 3, say: [`Engine ${NUM[n]} is on fire!`, `Number ${NUM[n]}'s on fire!`] };
}
// the crew: a man hit, a man killed (by name, as the co-pilot calls it); a Fort near us under attack (by her pilot's name)
for (const n of SURNAMES) {
  LINES[`hit_${n}`] = { by: ['copilot', 'pilot'], pri: 2, group: 'crewHit', gap: 8, say: [`${n}'s hit!`, `${n}'s been hit!`] };
  LINES[`dead_${n}`] = { by: ['copilot', 'pilot'], pri: 3, say: [`${n}'s dead.`, `We lost ${n}.`] };
  LINES[`goingFor_${n}`] = { by: ['waistL', 'waistR', 'engineer'], pri: 1, ttl: 6, group: 'goingFor', gap: 75, say: `They're going for ${n}'s ship!` };
}
// the real crews of 14 October 1943 (crewnames.js, from the records): too many names to record each in
// every line, so the co-pilot calls the man's station ("Tail gunner's hit!", "We lost our tail gunner.")
// and then his name, each name recorded once; the other Forts by their pilots' names
export const ROLE_WORDS = { pilot: 'Pilot', copilot: 'Co-pilot', bombardier: 'Bombardier', navigator: 'Navigator', engineer: 'Engineer', radio: 'Radio operator', ball: 'Ball gunner', waistL: 'Left waist', waistR: 'Right waist', tail: 'Tail gunner' };
for (const [id, w] of Object.entries(ROLE_WORDS)) {
  LINES[`hitRole_${id}`] = { by: ['copilot', 'pilot'], pri: 2, group: 'crewHit', gap: 8, say: [`${w}'s hit!`, `${w}'s been hit!`] };
  LINES[`deadRole_${id}`] = { by: ['copilot', 'pilot'], pri: 3, say: [`${w}'s dead.`, `We lost our ${w.toLowerCase()}.`] };
}
/** A name's line key: its letters only ("O'Neil" -> "ONeil"). */
export const nameKey = (s) => String(s).replace(/[^A-Za-z]/g, '');
for (const n of CREW_SURNAMES) LINES[`name_${nameKey(n)}`] = { by: ['copilot'], pri: 2, ttl: 8, say: `${n}.` };
for (const n of PILOT_SURNAMES) LINES[`goingForP_${nameKey(n)}`] = { by: ['engineer'], pri: 1, ttl: 6, group: 'goingFor', gap: 75, say: `They're going for ${n}'s ship!` };
// the fighters coming in, from wherever they really are: the first of the fight (and a big wave) with
// how many there are, the rest just where
for (let h = 1; h <= 12; h++) {
  for (const lvl of ['high', 'level', 'low']) {
    const where = `Bandits, ${NUM[h]} o'clock ${lvl}!`;
    LINES[`banditsMany${h}_${lvl}`] = { by: clockCallers(h, lvl), pri: 3, ttl: 4, say: [`${where} There's so many of them!`, `${where} Here they come, a whole gaggle!`] };
    LINES[`bandits${h}_${lvl}`] = { by: clockCallers(h, lvl), pri: 2, ttl: 4, say: where };
  }
}

/** A clip's id: the line, which version of it, in which voice. */
export const clipId = (key, i, voice) => `${key}.${i}.${voice}`;

/** The ways `spk` may say line `key`. */
export const versions = (key, spk) => [LINES[key].as?.[spk] ?? LINES[key].say].flat();

/** What `spk` says for line `key`, version `i`. */
export const words = (key, spk, i = 0) => versions(key, spk)[i] ?? versions(key, spk)[0];

// names the voice can't read as written, spelt the way they're said (for the recording only; the caption
// keeps the real spelling)
const SAY_AS = { Lindqvist: 'Lindquist', DeLuca: 'Dee Luca', Sorensen: 'Sorenson', Fischer: 'Fisher' };
const spoken = (t) => t.replace(/Lindqvist|DeLuca|Sorensen|Fischer/g, (n) => SAY_AS[n]);

/** Every clip to record: each version of each line in the voice of every man who may say it, and how. */
export function allClips() {
  const out = [];
  for (const [key, l] of Object.entries(LINES)) {
    for (const spk of new Set(l.by)) {
      const v = SPEAKERS[spk].voice, how = l.calm ? CALM : VOICES[v];
      versions(key, spk).forEach((text, i) => out.push({ id: clipId(key, i, v), voice: v, text: spoken(text), exaggeration: how.exaggeration, cfg: how.cfg }));
    }
  }
  return out;
}
