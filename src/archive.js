// The interphone as it really sounded: B-17 crews in combat, from The Memphis Belle (1944, the USAAF's
// film of the 91st Bomb Group's Wilhelmshaven raid of 15 May 1943: a US government work, public domain),
// the voices alone (the engines taken out). Each clip is played only when what it says is what's
// happening: a clock call when fighters really are at that o'clock, "bail out" when a Fort near us goes
// down, "I got him" when our gunners get one. public/audio/archive/belle_<id>.mp3; the sources and how
// they were cut: hackathon/archive_audio/SOURCES.md.

/**
 * on: the event it fits (bandits: fighters coming at us; engaged: one attacking our ship, close; fortHit: a
 * Fort near us starting to burn; fortDown, chutes: one going down, then her crew getting out; kill: our
 * gunners got one; bail: its pilot jumped; flak: a burst close by; bombRun: the IP). clock: the o'clock
 * it calls (it's only said when that's where it is, give or take an hour); level: high or low, if it says.
 */
export const ARCHIVE = [
  { id: '02_01', on: 'bandits', clock: [1], level: 'high', text: "There's four of them, one o'clock high. They're coming around. Watch." },
  { id: '02_02', on: 'bandits', clock: [6], level: 'high', text: "Two fighters, six o'clock up, coming in, diving at you." },
  { id: '02_05', on: 'bandits', clock: [9], text: "Three planes, nine o'clock, coming around. Keep your eye on them, boys." },
  { id: '02_06', on: 'bandits', clock: [10, 11], text: "Coming around to ten. Watch him, Chuck. Keep your eyes open. They're breaking eleven. Breaking eleven. I got him." },
  { id: '02_07', on: 'bandits', clock: [8, 10], text: "Coming around here at 8 or 10 o'clock. I see him." },
  { id: '02_10', on: 'bandits', clock: [10, 11], text: 'Ten-thirty, upper or lower?' },
  { id: '03_08', on: 'bandits', clock: [6, 3], text: "Fighters, six o'clock. ME 109 at three o'clock." },
  { id: '04_05', on: 'bandits', clock: [10, 12], text: "Fighters, ten o'clock. Watch those two at twelve. They're coming in. They're coming in, Scotty." },
  { id: '04_07', on: 'bandits', clock: [3], text: "Watch that fighter coming in at three o'clock." },
  { id: '02_04', on: 'bandits', text: 'Two more diving through the 94th.' }, // (no clock: any wave)
  { id: '02_08', on: 'engaged', text: 'Watch him, Scotty. I got my sights on him.' },
  { id: '04_01', on: 'engaged', text: "Keep after him, Mitchell. I see him. I'm on him." },
  { id: '04_02', on: 'engaged', text: 'Come on, you son of a bitch.' },
  { id: '04_06', on: 'engaged', level: 'low', text: 'Get that ball turret on them.' },
  { id: '04_08', on: 'engaged', clock: [11, 12, 1], text: "He's coming in at a half roll. Pull her up, Chief. Pull her up, hurry." },
  { id: '02_03', on: 'fortHit', clock: [2], text: "B-17 in trouble, out at two o'clock, watch it. Got an engine on fire." },
  { id: '02_09', on: 'fortHit', clock: [3], text: "Check that B-17, Chuck. Three o'clock. Motor's smoking. Fighters, ten-thirty. Coming around." },
  { id: '03_01', on: 'fortDown', text: "Come on, you guys. Get out of that plane. Bail out. There's one." },
  { id: '03_06', on: 'fortDown', text: 'Eight men still in that B-17.' },
  { id: '03_02', on: 'chutes', text: 'He come out of the bomb bay. Yeah, I see him.' },
  { id: '03_03', on: 'chutes', text: "There's a tail gunner coming out. Watch out for the fighter." },
  { id: '03_04', on: 'chutes', text: 'Keep your eye on him, Bill. See any parachutes, Quinlan? No parachutes.' },
  { id: '03_07', on: 'chutes', text: "Come on, the rest of you guys. Get out of there. Come on, bail. So far, three more chutes. Flak, eleven o'clock." },
  { id: '04_03', on: 'kill', text: "I got him. Let's confirm that fighter. He got him." },
  { id: '04_04', on: 'bail', text: "Look, he's bailing out. Damn it, don't yell on that intercom." },
  { id: '03_05', on: 'flak', clock: [9], text: "Flak at nine o'clock." },
  { id: '05_01', on: 'bombRun', text: "Pilot to bombardier. Okay, Vin, you've got it." },
  // (two of the Belle's men put together: her pilot's own "pilot to crew" from his oxygen call, and "bail
  // out!" called at a Fort going down in the same fight)
  { id: 'bail_order', on: 'bailOrder', text: 'Pilot to crew. Bail out!' },
];
export const archiveId = (a) => `belle_${a.id}`;

// s before the same kind of call again (the first of the fight is never held back), and before any clip
// is said a second time
const GAP = { bandits: 25, engaged: 35, fortHit: 50, fortDown: 60, chutes: 0, kill: 20, bail: 30, flak: 45, bombRun: 0, bailOrder: 0 };
const REPEAT = 240; // (the bail-out order excepted: archiveBail)
const near = (h, c) => { const d = Math.abs(h - c) % 12; return Math.min(d, 12 - d) <= 1; };

/** Picks the clip for an event, or null: none fits, or it's too soon. */
export class ArchivePicker {
  constructor() { this.reset(); }
  reset() { this.last = {}; this.said = {}; this.t = 0; }

  pick(on, { h = null, level = null } = {}) {
    if (this.t - (this.last[on] ?? -1e9) < GAP[on]) return null;
    const fits = ARCHIVE.filter((a) => a.on === on && (!a.clock || (h != null && a.clock.some((c) => near(h, c))))
      && (!a.level || a.level === level) && this.t - (this.said[a.id] ?? -1e9) > REPEAT);
    // (one that names where they are, over one that doesn't)
    const named = fits.filter((a) => a.clock);
    const from = named.length ? named : fits;
    if (!from.length) return null;
    const a = from[Math.floor(Math.random() * from.length)];
    this.last[on] = this.t; this.said[a.id] = this.t;
    return a;
  }
}
