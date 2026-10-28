// Checks on the Schweinfurt force and its records: node tests/blackthursday.test.mjs
// The formation (src/oob.js): 291 B-17s, 149 and 142 by division, every group at its count and in its
// wing, no two aircraft in one slot, none overlapping at the start. The records (historical_data/
// black_thursday): valid, every serial on one aircraft only, every confidence one of the four, every
// source a record cites listed. Exits non-zero on any failure.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forceSlots, FORCE, TOTALS } from '../src/oob.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0, passed = 0;
const check = (ok, what, detail = '') => { if (ok) passed++; else { failed++; console.log(`FAIL  ${what}${detail ? `: ${detail}` : ''}`); } };

// ---- the formation
const slots = forceSlots();
const count = (f) => slots.filter(f).length;
check(slots.length === TOTALS.all, 'exactly 291 B-17s at mission start', `${slots.length}`);
check(count((s) => s.division === '1st') === TOTALS['1st'], '1st Air Division 149', `${count((s) => s.division === '1st')}`);
check(count((s) => s.division === '3rd') === TOTALS['3rd'], '3rd Air Division 142', `${count((s) => s.division === '3rd')}`);
const ORDER = { '1st': ['91st', '92nd', '303rd', '305th', '306th', '351st', '379th', '381st', '384th'], '3rd': ['94th', '95th', '96th', '100th', '385th', '388th', '390th'] };
for (const [div, groups] of Object.entries(ORDER)) {
  for (const g of groups) check(count((s) => s.group === g) > 0 && slots.filter((s) => s.group === g).every((s) => s.division === div), `${g} flies, in the ${div} Division`);
}
check(new Set(slots.map((s) => s.group)).size === 16, 'sixteen bomb groups', `${new Set(slots.map((s) => s.group)).size}`);
for (const w of FORCE) for (const g of w.groups) {
  const n = count((s) => s.group === g.group && (s.part ?? null) === (g.part ?? null) && !s.attachedTo);
  check(n === g.n, `${g.group}${g.part ? `-${g.part}` : ''} has its ${g.n}`, `${n}`);
  check(slots.filter((s) => s.group === g.group && !s.attachedTo).every((s) => s.wing === w.wing || FORCE.some((x) => x.wing === s.wing && x.groups.some((y) => y.group === g.group))), `${g.group} in the ${w.wing} Combat Wing`);
}
check(count((s) => s.group === '100th') === 8 && slots.filter((s) => s.group === '100th').every((s) => ['95th', '390th'].includes(s.attachedTo)), "the 100th's eight with the 95th and the 390th");
const keys = slots.map((s) => s.pos.map((v) => v.toFixed(1)).join(','));
check(new Set(keys).size === slots.length, 'no two aircraft in one slot', `${slots.length - new Set(keys).size} duplicates`);
const per = new Map();
for (const s of slots) { const k = `${s.squad}|${s.group}|${s.squadron}|${s.element}|${s.wingman}`; per.set(k, (per.get(k) ?? 0) + 1); }
check([...per.values()].every((n) => n === 1), 'no duplicate slot assignments');
let closest = Infinity;
for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) {
  const a = slots[i].pos, b = slots[j].pos, d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  closest = Math.min(closest, d);
}
check(closest > 31.6, 'no aircraft overlapping at spawn (closer than a B-17\'s span, 31.6 m)', `closest ${closest.toFixed(1)} m`);
for (const w of FORCE) for (const g of w.groups) check(count((s) => s.squad === `${FORCE.indexOf(w)}-${g.pos[0].toUpperCase()}${g.pos.slice(1)}` && s.lead && s.group === g.group) === 1, `${g.group}${g.part ? `-${g.part}` : ''} has one lead ship`);

// ---- the records
const dir = join(root, 'historical_data/black_thursday');
const CONF = new Set(['VERIFIED', 'PROBABLE', 'UNVERIFIED', 'UNKNOWN']);
const sourceIds = new Set(JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8')).map((s) => s.id));
const serials = new Map();
let aircraft = 0, withSerial = 0, men = 0;
for (const f of readdirSync(join(dir, 'groups')).filter((x) => x.endsWith('.json') && !x.endsWith('_sources.json'))) {
  let data, src;
  try { data = JSON.parse(readFileSync(join(dir, 'groups', f), 'utf8')); src = JSON.parse(readFileSync(join(dir, 'groups', f.replace('.json', '_sources.json')), 'utf8')); } catch (e) { check(false, `${f} parses, with its sources`, e.message); continue; }
  for (const s of src) sourceIds.add(s.id);
  for (const a of data.aircraft ?? []) {
    aircraft++;
    if (a.serial_number && !a.duplicate_of) { withSerial++; const prev = serials.get(a.serial_number); check(!prev, `serial ${a.serial_number} on one aircraft only`, prev ? `${prev} and ${data.group}` : ''); serials.set(a.serial_number, data.group); }
    check(CONF.has(a.historical_confidence), `${data.group} ${a.serial_number ?? a.pilot ?? '?'}: a confidence level`, `${a.historical_confidence}`);
    for (const id of a.sources ?? []) check(sourceIds.has(id), `${data.group} ${a.serial_number ?? '?'}: source ${id} listed`);
    for (const m of a.crew ?? []) { men++; check(CONF.has(m.confidence), `${data.group} ${m.name}: a confidence level`, `${m.confidence}`); }
  }
}
// ---- the charted places (slots.json): each a real aircraft of that group, each a slot the group has, none twice
const charted = JSON.parse(readFileSync(join(dir, 'slots.json'), 'utf8')).slots;
const taken = new Set();
for (const c of charted) {
  check(serials.get(c.serial_number) === c.group, `charted ${c.serial_number} is a ${c.group} aircraft in the records`, `${serials.get(c.serial_number)}`);
  check(slots.some((s) => s.group === c.group && !s.attachedTo && s.squadron === c.squadron && s.element === c.element && s.wingman === c.wingman), `charted ${c.serial_number}: the ${c.group} has that slot (${c.squadron} ${c.element}/${c.wingman})`);
  const k = `${c.group}|${c.squadron}|${c.element}|${c.wingman}`;
  check(!taken.has(k), `charted slot ${k} given once`); taken.add(k);
  check(CONF.has(c.confidence), `charted ${c.serial_number}: a confidence level`);
}
console.log(`records: ${aircraft} aircraft (${withSerial} with serials), ${men} crewmen; ${charted.length} charted places`);
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
