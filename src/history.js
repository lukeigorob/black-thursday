// The real aircraft and men of Mission 115, Schweinfurt, 14 October 1943, from the research files in
// historical_data/black_thursday (one file a bomb group, each record with its sources and how sure it is:
// VERIFIED, PROBABLE, UNVERIFIED, UNKNOWN). Nothing here is made up: a bomber whose record isn't known gets
// no serial or name, and a man who isn't known is a placeholder, marked as one wherever he's shown.

const FILES = import.meta.glob('../historical_data/black_thursday/groups/*.json', { eager: true, import: 'default' });
const GROUPS = new Map(); // '306th' -> its file (aircraft, dispatched, research gaps)
for (const [path, data] of Object.entries(FILES)) if (!/_sources\.json$/.test(path) && data?.group) GROUPS.set(data.group, data);

/** The crew positions in the records, as the game's crew roles (crew.js). */
const POSITION_ROLE = { pilot: 'pilot', copilot: 'copilot', navigator: 'navigator', bombardier: 'bombardier', engineer: 'engineer', radio: 'radio', ball: 'ball', waist_left: 'waistL', waist_right: 'waistR', tail: 'tail' };

import SLOTS from '../historical_data/black_thursday/slots.json';

export const historyLoaded = () => GROUPS.size > 0;
/** The places the groups' own charts give their aircraft (slots.json): serial -> { squadron, element, wingman, basis, confidence }. */
export const CHARTED = new Map(SLOTS.slots.map((s) => [s.serial_number, s]));
export const groupRecord = (group) => GROUPS.get(group) ?? null;

/**
 * The aircraft a group flew that day, in the order the research has them (lead ship first where the
 * records say which it was). Records without a serial still count: the group did fly that many.
 */
export function groupAircraft(group) { return (GROUPS.get(group)?.aircraft ?? []).filter((a) => !a.duplicate_of); } // (a sortie filed under two groups: counted under one)

/**
 * The men of a record as the game's crew roles: { pilot: { name, rank, fate, confidence }, ... }. A
 * plain "waist" gunner goes to whichever waist is still free; men the game has no station for (a second
 * navigator, an observer) are left out of the roles but kept in the record.
 */
export function crewByRole(record) {
  const out = {};
  for (const m of record?.crew ?? []) {
    if (!m?.name || m.confidence === 'UNKNOWN') continue;
    let role = POSITION_ROLE[m.position];
    if (!role && m.position === 'waist') role = out.waistL ? 'waistR' : 'waistL';
    if (role && !out[role]) out[role] = { name: m.name, rank: m.rank ?? null, fate: m.fate ?? 'unknown', confidence: m.confidence ?? 'UNVERIFIED' };
  }
  return out;
}

/** A man's surname, for the intercom ("Kowalski's hit!"): the last word, past a "Jr." or "III". */
export function surnameOf(name) {
  const w = String(name).replace(/,/g, '').split(/\s+/).filter(Boolean);
  while (w.length > 1 && /^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w[w.length - 1])) w.pop();
  return w[w.length - 1] ?? name;
}

/**
 * What the game shows of a bomber's identity (the panel, the seat map): only what's recorded, with how
 * sure it is; null fields are unknown, not blank.
 */
export function identityOf(record, group) {
  if (!record) return { group, known: false };
  return {
    known: true, group, serial: record.serial_number ?? null, type: record.aircraft_type ?? null, block: record.block ?? null,
    nickname: record.nickname ?? null, squadron: record.bomb_squadron ?? null,
    code: record.squadron_code ? `${record.squadron_code}${record.aircraft_letter ? `-${record.aircraft_letter}` : ''}` : null,
    pilot: record.pilot ? `${record.pilot_rank ? `${record.pilot_rank} ` : ''}${record.pilot}` : null,
    outcome: record.mission_outcome ?? 'unknown', lossDetails: record.loss_details ?? null, macr: record.macr ?? null,
    confidence: record.historical_confidence ?? 'UNKNOWN', sources: record.sources ?? [],
  };
}
