# Prompt: crew voices, crew wounds, ripcord prompt, more Fw 190s, menu box, engine calls

You're working on a WWII B-17 bomber game (three.js + Vite) in `C:\Users\Garre\Documents\bomber-game`, branch `b17-nose-crawlways-ball-turret`. The working tree has a lot of uncommitted work. Keep it, work on top of it, and **don't commit** unless I ask. Build with `npx vite build`; the game is served from `dist` by vite preview at http://127.0.0.1:4173 (`?battle=small` gives a quicker 54-bomber test). Test in headless Chrome at 1920×1080, one browser at a time. Keep frames under 100 ms. When you're done, tell me plainly what works and what doesn't, with screenshots of anything visual.

Read these first:
- `src/radio.js`: the intercom. It turns log lines into spoken calls (the `HEARD` table, queueing, the gaps between calls).
- `src/lines.js`: the voice lines, who says them, and the clip ids.
- `scripts/voices/`: the voice generator. It writes clips to `public/audio/voice/`.
- `src/crew.js`: the crew, their names, wounds and deaths, and the messages from `emit()`.
- `src/bomber.js`: engine states (`ok | smoking | dead | fire`) and the damage messages.
- `src/main.js`: player health, the J key (bail-out bell, ripcord) and the HUD.
- `src/ui.js`: the start menu, including Mission conditions (`#menu-cond`), and the damage panel.
- `src/eject.js`: free fall and the ripcord.
- `src/battle.js`: fighter numbers.

## 1. Voices: less repetition, more variety, better delivery
- Some calls repeat far too much. "There's so many of them" is the worst; there's a `MANY_GAP` in radio.js. Give every line a sensible minimum gap, and never play the same clip twice in a row.
- Every common call needs 3–5 versions, recorded with different wording and by different crewmen where that fits. Pick one at random, avoiding the version used last.
- "Flak ahead, brace" doesn't sound good. Re-record it, plus any other clip that sounds robotic, clipped or badly paced. Listen through all the clips in `public/audio/voice/`, list the bad ones, and redo them with the generator.
- Some calls should be said calmly, as routine radio procedure, not acted out. Re-record these with less emotion (flat, clipped, matter-of-fact):
  - Pilot to bombardier, "Your ship" (the `yourShip` line at the initial point).
  - Bombardier to pilot, "My ship" (the `myShip` line).
  - Pilot to crew, "Flak ahead" (the `flakAhead` line). Calm and steady, not shouted.
- New call: "There's a hole in the wing!" (left or right) when a wing's damage gets high. Say it once per wing per mission, from the crewman who can see that wing: the waist gunner on that side, the pilot or co-pilot, or the engineer in the top turret. Wing health per side is in `src/bomber.js` (`hp`, per part).

## 2. Crew hits and deaths, by name
- When a crewman is hit, the co-pilot (or the pilot, if the co-pilot is the one hit or is dead) calls it by role and name, e.g. "Waist gunner's hit! Kowalski's down!"
- When one is killed: "Bombardier's dead. We lost Stroud." Every crewman has a name in crew.js. Since the names vary, these lines have to be built from a few recorded parts (a role clip, a name clip, a phrase clip), or each crew name has to be recorded once. Pick whichever sounds natural.
- New call: "They're going for [pilot's name]'s ship!" when a gaggle goes for a nearby B-17. That needs a pilot name for each nearby bomber (other bombers' crews have generated names too). Call it now and then, not on every attack.

## 3. Engine calls from the pilots
- When an engine starts smoking: "Engine 1 is hit!" (2, 3 and 4 the same way).
- When it catches fire: "Engine 1 is on fire!" (all four). There's already an `engFire` line, so check it covers all four engines and plays reliably.
- Spoken by the pilot or co-pilot, whichever is alive.

## 4. Damage to the player's own body, like the plane's
- Give the player's body hit zones the way the planes have them: head, torso, arms and legs.
- Damage depends on where you're hit: a head hit is very serious, torso medium-to-high, arms and legs low.
- Show it the way the plane damage is shown: a small man figure on the HUD whose parts change colour as they're hurt.
- Keep it consistent with the health, wounds and first aid that already exist.

## 5. Ripcord prompt
- J already pulls the ripcord in free fall (`eject.pull()`). Show an on-screen prompt the moment you're clear of the plane, "Press J to pull the ripcord", and hide it once the chute opens. That includes the static line opening it for you at 7 s.

## 6. 50 more Fw 190s
- Add 50 Fw 190s to the Luftwaffe's total in `src/battle.js`, in every battle size. Check that the wave logic sends them up as Fw 190s, not Bf 109s.
- After the change, check frame times and B-17 losses in a full mission. The loss steering in main.js and streambattle.js aims for 20% of the B-17s lost.

## 7. Mission conditions box on the start menu
- Put the Mission conditions section (`#menu-cond`, Default / Choose / Random, plus the time, season and weather pickers) in a clear framed box, so players notice it and can see it's something they can choose. Keep it in the menu's existing style; see `src/menus.css`.

Do each part, build, and test it in the game: listen to new clips, take screenshots of the HUD figure, the ripcord prompt and the menu box, and run one full mission to the debrief at the end to make sure nothing broke.
