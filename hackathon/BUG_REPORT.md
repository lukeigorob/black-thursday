# B-17 bug report — 27 Oct 2026

## Fix status (bugs 1–25 fixed and re-tested; nothing committed)

The fixes are in the working tree, not committed. Then the same 10-role test was run again; after-fix screenshots are in `hackathon/bug-shots/after_*.jpg`.

| # | Bug | What changed | Re-test |
|---|-----|--------------|---------|
| 1 | B-17s collide too often | `fighters.js`: each pair rolls once per 3 s close pass, 15% chance (was 30% every frame) | 0–2 per mission (was 3–8). They still happen, but now as rare events |
| 2 | Dead pilot talks | `main.js`: the line is said by the pilot, else the co-pilot, else unattributed | The line played twice with the pilot alive, as it should. No run had it play after both pilots died, so the dead-pilot case is checked in the code only |
| 3 | Radio operator unpickable | `ui.js`: your own row is clickable | Radio run boarded and flew the whole mission (`after_radio_seat.jpg`) |
| 4 | Stale seat map | `main.js`: `chooseRole`/`takeSeat` cancel `seatTimer`; leaving the crew while dead marks your man dead | Code only (not hit by the test) |
| 5 | Luftwaffe end never early | `mission.js`: your own fighter isn't counted | Code only (the test doesn't reach that point) |
| 6 | Bail-out goes up | `main.js`: `startEject` uses its own vector | Code only |
| 7 | Regroup out of sync | `main.js`: `reform()` calls `mission.regroup()` when a squad merged | Code only |
| 8 | Fire inside fills the view | `effects.js`: particles fade out when close to the camera (relative to their size), sprites are round, fire falloff is softer. **Second pass:** trails within 60 m of the camera (your own bomber's) are drawn at real size: flames smaller (down to 22%), dimmer (down to 18%) and three times as many; smoke leaves small, fainter, already moving with the air so it streams straight back. Trails seen from further off are unchanged | **Fixed.** Pilot with engines 1–2 burning: smoke and fire in view within 40 m dropped from a cover score of 760–1020 to 5–9; the flames and smoke show over the wing with no white glare or dark wall (`bug8_before_pilot_engine_fire.jpg` → `bug8_after_pilot_engine_fire.jpg`, `bug8_after_pilot_wing_fire.jpg`). **Third pass:** close-up flames get their own pool with a smooth glow sprite (no core, no edge), each small and dim, so they overlap into one flame. From the left waist the trail now reads as one flame under its smoke (`bug8_before_waist_engine_fire.jpg` → `bug8_after_waist_engine_fire.jpg`) |
| 9 | Ball turret white / slab | Same fix as 8 (it was smoke sprites at the lens and their square edges) | No white-out or slab in the ball run (`after_ball_rally.jpg`) |
| 10 | P-51 mirror slab | `cockpit.js`: smaller, on a stem under the bow, dark frame, dim face | Reads as a mirror now (`after_p51_mirror.jpg`) |
| 11 | Hint under scoreboard | `index.html`: `top: 124px` | Clear of the scoreboard (`after_hint.jpg`) |
| 12 | Stale clock call | `radio.js` + `fighters.js`: the clock is re-checked when the line starts. One hour out, it's reworded. Further out, it's dropped | Code only |
| 13 | Navigator has no seat | `crew.js`: navigator mans the left cheek gun (kneeling) | Starts at the cheek gun (`after_navigator_cheek_gun.jpg`) |
| 14 | AI fighters near the ground | `fighters.js`: below 1,500 m above the ground they climb. Dogfights more than 3 km from the bombers are broken off | No "fighter stuck low" in any run |
| 15 | Player 109 collides at 0:18 | `fighters.js`: your 109/190 starts 1.8 km to the side, 600 m up, flying with the stream | Bf 109 run flew the whole mission with no collision |

### Bugs 16–25 (low priority: fixed, re-tested; nothing committed)

Each was made to happen on purpose in a test mission (`t_low.js`, headless Chrome 1920×1080), then checked.

| # | Bug | What changed | Re-test |
|---|-----|--------------|---------|
| 16 | Pausing ends the parachute view | `main.js`: the eject's "go again" click only counts while playing | Clicked on the pause menu: still under the chute. Clicked after resuming: it ended |
| 17 | Seat change during the tail ride heals you | `main.js`: no seat list while riding the tail or under a chute; `moveToSeat` keeps your health | Health 0.55 stayed 0.55 after a seat change; no seat buttons while riding the tail |
| 18 | Pilot debrief counts gunners' kills | `main.js` + `fighters.js`: `pilotStats` counts its own fighter kills and "attacks broken up", only while flying a fighter | A kill at a B-17's gun: life kills 1, pilot fighters 0, saved 0 |
| 19 | Tail gunner's figure stays on the falling tail | `crew.js`: `handFiguresTo` brings a figure that's off the interior back aboard | After boarding another bomber, her tail gunner's figure is in the interior |
| 20 | Bailing crew left behind get stuck | `crew.js`: the crew you leave get a `walkT`; a crew you join see their bailers walk to the hatch; bailing out calls `checkPilots` | The man left bailing was out ("bailed") within 9 s |
| 21 | Holes miss parts hidden at the first hit | `scars.js`: all skin meshes are collected; only the ones shown now are raycast | 49 meshes collected, 14 of them hidden at the time |
| 22 | Old wrecks called again after a reset | `radio.js`: after a reset, the Forts already down are taken as known | A Fort downed before a reset: no "Fort going down" after it |
| 23 | Bump holes in the wrong place | `fighters.js`: the bump direction goes into the bomber's own frame (`x._inv`) before `addScar` | Code only (a bump wasn't staged) |
| 24 | Swapping bombers loses state | `bomber.js`: `lastHitBy`, `lastHitT`, `playerHitT`, `crashed` swap too; `main.js`: `downSeen` goes with the swap | `lastHitBy` came across with the bomber's state |
| 25 | "My ship" without "your ship" | `radio.js`: the pair is said only if the pilot can speak (not you, not dead) | As the pilot: neither line queued, the plain log line instead |

**Full-mission check after 16–25:** pilot and P-51 missions run through, no test issues flagged, no script errors. As the pilot, the IP call showed as the plain log line with no "My ship" after it. The pilot run had 2 B-17 collisions and one 19.4 s frame (every other frame under 90 ms). That looks like the same one-off stall seen before on this machine, but I didn't prove it. The P-51 run had 2 frames over 100 ms (worst 263 ms).

### The three open items, followed up (full missions to the debrief)

The test now runs a mission all the way to the debrief. It skips most of the homeward leg, skips only while no bombs are falling, and stops each skip 3 km short of the front group's release point. It also logs every frame over 300 ms, long tasks, memory, particle counts, collisions and low fighters. Six full missions were run: pilot ×4, Bf 109 and tail.

- **The mission end works.** Every run reached "Mission complete" and the debrief, with no flagged issues and no script errors (`full_mission_pilot_debrief.jpg`).
- **Bombing in the debrief:** earlier test runs showed 0–4% of bombs on target. That was the test's skips: they jumped the target out from under falling bombs, and carried the leading groups past their release points. With the skips fixed, it was 54% (and 100% for your own group). In a run with no skips through the bomb run it was 97% (433 of 444). That second figure is very high next to the real 8th Air Force; worth a look if it should be harder.
- **Slow frames (bug 26):** not reproduced.
  - **This round:** 6 missions and about 160,000 frames. There were 0 frames over 300 ms, 0 long tasks over 300 ms, and only 0–7 frames over 100 ms per run (the worst was 167 ms).
  - **Memory and particles:** memory stayed at 100–150 MB all mission, with no growth. Smoke particles sit near their 12,000 cap for most of a crew mission, and the trails thin out as designed. They don't grow without limit.
  - **Earlier huge frames:** the 3–19 s frames from earlier runs didn't happen once here. Same game, same test, so they point to this machine stalling (it had about 1.8 GB free). That still isn't proof. Running on another machine would settle it.
- **B-17 collision chance (15% per close pass):** 0, 0, 1, 1, 3 and 1 collisions per mission. They're rare events now; 3 in one mission was the most. I can't judge the feel without playing, so this is left as is.
- **The fighter floor (1,500 m above the ground):** no AI fighter dropped below 2,500 m above the ground in any of the six runs. The floor isn't getting in the way, and nothing is fighting down low. It's left as is.
- **Worth a look (not a bug):** 24–29 of 54 B-17s are lost in every mission (about half). That's far heavier than a typical 1944 mission. It may be deliberate. *(Followed up below.)*

### Difficulty: B-17 losses and bombing (changed; nothing committed)

Measured in missions flown in real time, with no skips (the test's skips had inflated losses: each one raised the loss target in one jump).

- **Why about half were lost:**
  - **Goal:** the game steers B-17 losses toward a goal, which was 35%.
  - **Overshoot:** bombers that were already burning kept going down after the steering had cut enemy hits to its minimum.
  - **Pilotless bombers:** the biggest single cause on the way home. In 12 of 27 losses one run, both pilots had been killed, and the bomber then glided out and went down 150 s later.
  - **Crew wounds:** both pilots were dying because wounds to the crews (gunfire, and flak fragments) weren't covered by the steering at all.
- **Changes:**
  - **Goal:** 20% of B-17s lost, about Schweinfurt, the worst kind of day. The steering aims at 14%, because fires and collisions add a few per cent it can't stop.
  - **Crippled bombers:** bombers burning, with two engines out, straggling or with nobody at the controls now count as partly lost (`Bomber.peril`), so the steering eases off before they fall.
  - **Steering strength:** it reacts harder to being ahead of schedule, and its minimum is lower (0.02, from 0.1).
  - **Crew wounds:** wounds to the other bombers' crews, from gunfire and from flak fragments, are now held back as their airframes are. Your own bomber's crew is unaffected.
  - **Taking the controls:** in other bombers, when both pilots are dead, the engineer (or the bombardier, or the navigator) takes the controls and flies her on.
- **Result:** B-17s lost per mission went 21, 30, 27 (before) → 19, 16, 18, 15, 17 (while tuning) → **10 of 54 (19%)** with everything in. Pilotless losses went from 12 to 0, and men killed in the other bombers from 117 to 6.
- **Bombing:** left as it is.
  - **The 97% run:** luck. The small test battle has only 3 groups, so one mission can land anywhere from about 33% to 83%. Real-time runs gave 57%, 66%, 74%, 34%, 44%, 74%, 64% and 34%.
  - **The real game** (large battle, 15 groups) should average about 44% (a simulation of the aiming errors: 9 missions in 10 between 32% and 56%), about right for good-weather visual bombing in 1944.

### New features (from `NEXT_PROMPT.md`; nothing committed)

- **Ripcord prompt:** "Press J to pull your parachute" was already in the code, but a style rule hid every prompt while you were bailing out. It now shows in free fall (`ripcord_prompt.jpg`).
- **Mission conditions:** framed in a box on the start menu, with a label tab on top (`menu_conditions_box.jpg`).
- **50 more Fw 190s:** the reserve of Fw 190s went from 50 to 100, and every battle size's total went up by 50, so the number of 109s is unchanged.
- **Body hit zones:** a hit on you now lands on your head, chest, an arm or a leg, by its height up your body and its side.
  - **Harm:** a head hit does 2.2 times the harm of a chest hit, an arm or leg 0.45 times.
  - **Messages:** "You're hit in the left arm!".
  - **HUD:** the "You" box shows a small figure whose parts are tinted like the bomber's damage diagram, plus the worst wound ("Head hurt"). The minimap moved down to make room (`hud_wound_figure.jpg`).
  - **Share of hits:** in a test of 400 hits, about 8% head, 36% chest, 20% arms and 37% legs.
- **Intercom:**
  - **Versions:** most lines now have 2–3, never the same one twice in a row.
  - **Gaps:** lines can have a minimum gap. Crew-hit calls are at least 8 s apart, "they're going for…" 75 s, and "there's so many of them" 4 minutes (from 1.5); fighter positions are at least 30 s apart (from 20).
  - **New calls:**
    - "Engine two's hit, she's smoking!" / "Engine two is on fire!" (all four engines).
    - "There's a hole in the left wing!" (once a wing, when it's badly shot up).
    - "Stroud's hit!" and "We lost Murphy." (the co-pilot, or the pilot, by name; the log adds the man's job).
    - "They're going for Abbott's ship!" (a fighter diving on a B-17 near you, by her pilot's name).
  - **Calmer delivery:** "your ship", "my ship" and "flak ahead" are said calmly. Every voice's emotion is toned down (the gunners from 1.8 to 1.2), which also cuts the stray sounds some clips had at the end.
  - **Recording:** all 606 clips are recorded again with Chatterbox, 2–3 takes each, with the best kept by Whisper.
    - **Second pass:** 48 clips with stray sounds or mangled names were redone at 5 takes each. Lindqvist and DeLuca are recorded from a phonetic spelling; the caption keeps the real one.
    - **Result:** 19.6 minutes in all, 3.8 MB, every clip loading in the game.

### Schweinfurt, 14 October 1943 (replaces the 1944 mission; nothing committed)

- **The setting:** the briefing, the menu, the loading screen and the page text are now Black Thursday, Schweinfurt and its ball-bearing works (`menu_schweinfurt.jpg`).
  - **Loading tips:** now 1943 facts: the B-17F, the P-47's short range, 60 of 291 lost.
  - **Altitude and conditions:** unchanged, because the game has no autumn option yet.
- **291 B-17s:** six combat wings, the sixth cut short at 21 bombers (`BATTLE.bombers`).
- **P-47D Thunderbolts replace the P-51s, everywhere:**
  - **Model:** a "razorback" built in code (`src/p47.js`): olive drab over neutral grey, white cowl and tail bands, 1943 star and bars, a four-blade Curtiss prop, eight .50s (`p47_outside.jpg`).
  - **Cockpit:** framed windscreen, sliding hood, solid spine behind the head, N-3B sight (`p47_cockpit.jpg`).
  - **Flight data:** heavier, a worse turner, very hard to bring down.
  - **Elsewhere:** the role card, scoreboard, debrief and markers all say P-47.
- **The escort turns back for fuel:** 75 s after the first attack on the bombers, every AI P-47 turns for home and none come back. The crew say "Little friends are turning back. We're on our own, boys." (two versions, recorded).
- **Your own P-47:**
  - **Warning:** when the escort turns back you get "Bingo fuel!" and 40 s on the clock ("Fuel low: you must turn for home in 39 s").
  - **The end of the sortie:** "Out of fuel: you turned for home". Joining later, you get just those 40 s.
- **Losses: a fifth, to fighters and flak:**
  - **Goal:** 20%; the steering aims at 16%.
  - **Schedule:** about half go down on the way in (to the fighters, after the escort has turned back), a third over the target (flak engine fires and the fighters beyond), and the rest on the way home.
  - **The fighters:** their fire counts for 0.8 again (from 0.5).
  - **Men aboard:** wounds to the men in the bombers that come home are never held back below 40% of the full rate, so they bring dead and wounded home.
- **Result (one real-time mission, 291 bombers):**
  - **Losses:** 57 of 291 B-17s lost (19.6%); the real raid lost 60.
  - **Escort:** the P-47s turned back at 122 s.
  - **Flak:** 41 engines set on fire.
  - **Bombing:** 60% on target.
  - **Dead aboard:** only 2 men in the bombers that came home. The real raid had about 5 killed and 40 wounded aboard the returning bombers; raise it if you want more.
- **Three follow-up fixes:**
  - **P-47 canopy:** the "thick arch" was the windscreen's rear bow, 0.3 m ahead of the eye, ringing the top of the view. It now sits nearly overhead (0.18 m further back) and is thinner (1.1 cm). The overhead hoop moved behind the head. The view ahead is clear (`p47_cockpit.jpg`).
  - **Names:** Sorensen and Fischer are now recorded from a phonetic spelling, like Lindqvist and DeLuca. The doubtful Stroud, DeLuca and Dunn clips were redone at 6 takes. One Stroud clip still sounds slightly off to Whisper; Dunn reads as "done", which is how it's said.
  - **Autumn season:** a new option, with stubble, ploughed fields, and russet and gold woods. It's the default ("Clear · Day · Autumn") for Schweinfurt (`autumn_ground.jpg`). Players who saved "Choose" with Summer keep their choice.
- **Before Schweinfurt** (the 1944 mission at 270 bombers, aiming at about 30% with flak doing most of the work): 74 of 270 lost (27%), with 90 flak engine fires.

---

## Original report

**Nothing below had been fixed when it was written.** See the table above for what has been fixed since.

**How this was found:** 10 test missions in headless Chrome at 1920×1080, one in each of these roles: ball, engineer (top turret), pilot, bombardier, navigator, radio operator, Bf 109, Fw 190, P-51 and tail. Each mission was sped up with time skips and checked every second for impossible states. Each run also logged the radio calls and the game log, and took 14 screenshots, about 130 in all. On top of that I reviewed the code for the systems touched this week.

**Labels:**
- **Confirmed**: I traced the cause in the code.
- **Plausible**: the cause is likely but I haven't proved it.
- **Test**: caused by how the test drives the game, not something a player would hit.

The screenshots referred to below are in `hackathon/bug-shots/`.

**Already fixed in this session, uncommitted:**
- Flak hole raycasts are now queued, 3 per frame. This fixed the 60–95 ms frames.
- Web Audio engine and turret sounds are now updated only when they change. They had been taking 14% of the main thread.

---

## High: wrong outcomes or a broken game

### 1. B-17s collide with each other far too often (Confirmed)
**What:** Every test mission had 3 to 8 "Two B-17s have collided!" events, and each one destroys two bombers. That makes collisions a large share of all bomber losses: 21 of 54 bombers were lost in one run. In the pilot run, other B-17s also drifted into your bomber (screenshot `pilot_b17_overlap.jpg`, where a B-17 fills the cockpit window).
**Why:** In `fighters.js:924`, a crippled bomber (down, or with 2 or more engines dead) rolls `Math.random() < 0.7 → skip` **every frame**. The comment says "most near things miss", but at 60 fps a 30% chance per frame means any bomber within 11 m for even a fraction of a second is almost certain to collide. Fighter collisions don't have this problem because they use `closeCall()`, which rolls once per pass.
**Fix:** Use the same once-per-pass roll for this check: keep a `b.passUntil` on the pair, roll a small chance such as 0.15 once, then ignore that pair for about 2 s. Or scale the chance by `dt`.

### 2. A dead pilot gives orders on the radio (Confirmed)
**What:** In the engineer run, the log said "Both pilots are dead!" at 167 s, then "Pilot to crew: we've lost the formation…" at 192 s. In the navigator run, the pilot was killed at 327 s and still "spoke" at 369 s.
**Why:** `main.js:941` always uses the "Pilot to crew" line and never checks who is alive.
**Fix:** Have the most senior live officer say it (pilot, then co-pilot, then navigator), or drop the attribution when both pilots are gone ("We've lost the formation!").

### 3. You can't pick the radio operator at the start (Confirmed)
**What:** On first boarding, the seat map shows Radio operator as "YOU", greyed out and not clickable. The game holds on the seat map, so there's no way to play radio operator. Screenshot: `radio_seat_unpickable.jpg`.
**Why:** `main.js:147` makes the radio operator the player's man by default (`playerRole: 'radio'`), so he has `state === 'player'`. But `ui.js:736` disables every row whose state isn't `'ok'`.
**Fix:** Also enable the `'player'` row. Clicking it calls `onPick` → `takeSeat`, which just puts you at that station.

### 4. Changing seat doesn't cancel a pending seat map (Confirmed, from code review)
**What:** If you choose a new seat or a fighter within 2.5 s of dying, the old seat map pops up anyway. That can kill the man you just boarded or pull you out of your fighter.
**Why:** `seatTimer` (`main.js:611`) is never cleared in `chooseRole` or `takeSeat`.
**Fix:** Call `clearTimeout(seatTimer)` at the start of both.

### 5. A Luftwaffe pilot always has to fly the whole homeward leg (Confirmed, from code review)
**What:** As a 109 or 190 pilot, the "thin out / quiet" ending never triggers early.
**Why:** In `mission.js:160` and `:187`, your own fighter (state `'player'`) counts as an active axis fighter, so the sky is never "clear".
**Fix:** Skip `f.player` in those counts.

### 6. Bailing out of the B-17 throws you upward (Confirmed, from code review)
**What:** Your bail-out velocity comes out as +2 m/s up instead of −3 m/s down.
**Why:** `bailOut` passes the shared `_up` vector as the velocity (`main.js:389`). Then `startEject` (`main.js:458`) reuses `_up.set(0, 2, 0)` to offset the position, which overwrites the velocity.
**Fix:** In `startEject`, use a separate scratch vector, or `vel.clone()` before the offset.

### 7. Regrouping can leave your bombs in the racks (Plausible, from code review)
**Why:** `reform()` changes `b.squad`, but `mission.regroup()` isn't called afterwards, so the mission's groups go out of sync and the "your group is over the target" check can miss.
**Fix:** Call `mission.regroup()` at the end of `reform()` whenever any squad changed.

---

## Medium: things that look or sound wrong

### 8. Fire inside the bomber turns the view into a grey or black sky full of glowing discs (Plausible)
**What:** When your B-17 is burning, the windows go flat grey or black and fill with hard-edged bright circles. This happened in the pilot, engineer and ball runs (`pilot_black_sky_fire.jpg`, `engineer_grey_sky_fire.jpg`). In the radio room or waist, the whole screen bleaches to white-yellow glare (`navigator_fire_glare.jpg`).
**Why:** The fire and smoke particles are spawned on your own bomber's sections, so the camera sits inside them:
- Smoke billboards next to the lens cover the whole window.
- The ember or fire sprites, seen up close, show as big discs.
- The fire point-light, together with bloom, washes out the interior.
**Fix:**
- Fade particles out by distance to the camera, with a near-fade of about 3–4 m in the particle shader.
- Don't draw your own bomber's exterior smoke while the camera is inside her.
- Cap the cabin fire light's intensity and the bloom near the camera.

### 9. The ball turret view goes fully white, and a slab cuts through the glass (Plausible)
**What:** At rally, the ball turret glass showed nothing but white, with part of the turret ring missing (`ball_white_view.jpg`). On the way home, a flat white slab cut through the right side of the view (`ball_slab_through_glass.jpg`).
**Why:** Probably the turret aimed up into the belly, so the camera is inside the fuselage skin or the frosted inner glass. The slab looks like a broken-off wing or flap panel, or a part of another bomber, passing through the near plane.
**Fix:** Clamp the ball's elevation so the camera never enters the hull. Set the camera's `near` to about 0.05 inside turrets, and cull wreck pieces within about 1 m of the camera.

### 10. The P-51's rear-view mirror is a big pale block floating above the windscreen (Confirmed)
**What:** Screenshot `p51_mirror.jpg`.
**Why:** `cockpit.js:632` places a 14 cm box at `ws.yt + 0.005`, but the canopy bow it should sit on is drawn at `ws.yt - 0.02`, so it floats with nothing holding it. It's also metalness 1 with roughness 0.05, so it just shows the bright sky and reads as a white slab.
**Fix:**
- Lower it onto the bow (y ≈ `ws.yt - 0.015`) and add a short stem.
- Give it a dark frame with a darker, rougher face: color about 0x556066, roughness 0.3.
- Shrink it to about 0.10 × 0.03.

### 11. The "Click to capture the mouse" hint is half hidden under the scoreboard (Confirmed)
**What:** In every role (`hint_under_scoreboard.jpg`).
**Why:** `#hint` is fixed at `top: 96px` (`index.html:43`), but the bombers / Luftwaffe / P-51 scoreboard (`ui.js:227`) now reaches down to about 108 px.
**Fix:** Move it to `top: 124px`, or position it from `#forces.getBoundingClientRect().bottom + 8`.

### 12. A stale clock call when the formation turns (Confirmed, radio)
**What:** At the rally turn, a "bandits 3 o'clock" call can play after the formation has turned, so the bandits are really at 1 or 2 o'clock.
**Why:** The clock position is worked out when the line is queued. A line can then wait up to its 4 s `ttl` behind other speech.
**Fix:** Work out the clock again from the fighter's position when the line actually starts, and drop it if the clock has changed by more than 1 hour.

### 13. The navigator has no seat (Design gap)
**What:** As navigator, you start standing in the radio room facing the bomb-bay bulkhead, with nothing to do (`navigator_no_station.jpg`).
**Why:** `crew.js:43`: `station: null`, by choice ("the navigator rides aft"). But the B-17F nose has the cheek guns (`cheekL` and `cheekR` already exist).
**Fix:** Give the navigator `station: 'cheekL'`, which is historically right for the F model.

### 14. An AI fighter can dogfight a few hundred metres off the ground for minutes (Confirmed: no floor)
**What:** In the ball and tail runs, a Bf 109 in `engage` sat about 520 m above the ground (y ≈ −7080, with the ground at −7600) for 3–4 minutes, far from the fight.
**Why:**
- Only the player's fighter checks for the ground (`pilot.js:163`); AI fighters have no altitude floor.
- In `hunt`, a hunter keeps its prey for as long as it's alive (`fighters.js:664` only re-picks when the prey is dead), and `engage` drops it only when it's more than 4 km away. So two fighters can spiral down together and stay down there.
**Fix:**
- In `fly()`, if `ALTITUDE + f.pos.y < 1500`, steer upward.
- In `hunt` and `engage`, drop the prey once it's more than 3 km from `this.center`.

### 15. A fighter pilot who doesn't touch the controls collides within about 18 s (Plausible)
**What:** The Bf 109 run ended with "You collided" at 0:18 (`bf109_collided_18s.jpg`). A new player who hasn't clicked to capture the mouse yet would hit the same thing.
**Why:** `spawnPlayer` → `spawn(kind, -1)` starts the 109 on an attack line straight at the stream. With no input, it holds that line into a B-17.
**Fix:** Spawn the player's fighter about 1.5 km off to the side of the stream, heading parallel to it, or give it 5 s of autopilot until the first input.

---

## Low: polish and bookkeeping (from code review)

16. **Pausing ends the parachute view** (`eject.js:48`): a mousedown on the pause menu counts as "skip the parachute view". Fix: ignore the click unless `state === 'playing'`.
17. **Picking a seat during the tail ride heals you** (`moveToSeat` → `becomes()` restores full health). Fix: refuse a seat change while `player.ridingTail`, and keep the wound state.
18. **The pilot debrief counts the gunners' kills** (it reads `fighters.kills` and `saved`). Fix: use the counters in `pilotStats` only.
19. **The tail gunner's figure stays on a falling tail**: `handFiguresTo` doesn't re-parent it. Fix: re-parent it to the tail piece's group.
20. **Crew left bailing in a bomber you've left get stuck**: `walkT` is undefined and `checkPilots` isn't called. Fix: initialise `walkT` and call `checkPilots` for non-player bombers.
21. **Holes miss hidden parts**: the scar mesh cache (`scars.js:115`, `collect()` keeps only `o.visible` meshes) is built at the first hit, so parts hidden at that moment never get holes. Fix: collect without the visibility filter, and test `visible` when raycasting.
22. **Old wrecks get "Fort going down" calls**: radio `reset()` clears its `down` set, so wrecks from before the reset are called again. Fix: on reset, seed `down` with the bombers already down.
23. **Bump holes land in the wrong place**: a bomber bump passes a world-space direction to `addScar`, which expects bomber space. Fix: `dir.transformDirection(inv)` first.
24. **Swapping bombers loses some state**: `swapBombers`' STATE list misses `lastHitBy` and `crashed`, and the `downSeen` handling. Fix: add them to the list.
25. **The pilot hears "My ship" with no question before it**: when you're the pilot, "Your ship" is skipped (your own line), but the bombardier's "My ship" still plays. Fix: also skip `myShip` when the player is the pilot.

---

## Performance: still open

### 26. Frames of 100–440 ms in the second half of a mission (Unresolved)
**What:** Frames over 100 ms per run were: ball 4, bombardier 1, tail 6, navigator 14, pilot 20, engineer 26. The worst was 438 ms (pilot). There are none in the first ~4 minutes; on the way home they come every 12–15 s.
**What I know:**
- A CPU profile of the slow frames shows the same mix of functions as normal frames, just about 6× slower.
- The worst runs were the ones with the most fire and particles, and with your bomber straggling.
- The test machine had only about 1.8 GB of RAM free.
So it's either memory pressure or garbage collection on this machine, or particle and fire growth late in the mission.
**Next step (needs your OK):**
1. Run one mission with the bomber kept unburnt.
2. Run one with `performance.memory` logged against the slow frames.
3. Check whether particle counts grow without limit.

---

## Test artifacts (not game bugs)
- Groups of 5–7 crew "hit" in the same instant (e.g. at 130.9 s and 192.7 s) line up with the test's time skips: the skipped damage lands in one frame.
- The fighter and radio runs ended with a harness error (`g.audio.clips` undefined), because no voice line had played yet.
- Bombers at 0% airframe staying in the air, "dead crewman at station", and "bomber far below the formation" all come from the test turning off `goDown`.

### Historical reconstruction of Black Thursday (nothing committed)

The full write-up is in `BLACK_THURSDAY_RESEARCH.md` (sources, confirmed facts, uncertainties, and how the game uses them) and `historical_data/black_thursday/RESEARCH_PROGRESS.md` (the database's coverage, group by group).

- **The formation** (`src/oob.js`):
  - **Size:** 291 B-17s, the 1st Air Division's 149 and the 3rd's 142, in six combat wings and sixteen bomb groups. The 96th flew two groups, and the 100th's eight flew as flights with the 95th and the 390th.
  - **Counts:** each group at its recorded count, or an estimate where the records disagree or are missing, marked as one.
  - **Layout:** elements of three, squadrons stepped down, high and low squadrons and groups, wings two minutes apart, and the divisions 30 miles abreast. Every offset is in one configurable table.
  - **Your place:** left wing on the 92nd's lead ship (Col. Peaslee).
- **In flight:**
  - **Station-keeping:** every pilot keeps station by hand, a few metres out and back, banking into his corrections.
  - **Damage:** crippled bombers drop out and straggle; gaps stay open.
  - **Succession:** command passes to the wingman or deputy when a leader falls.
  - **Bombing:** the far groups bomb on their own, and the rally waits only for your wing.
- **The database:**
  - **Coverage:** 208 of 291 aircraft identified, 182 with serials; 147 complete crews and 1,821 men named; all 60 of the day's losses identified. Every record has its sources and a confidence level (VERIFIED, PROBABLE, UNVERIFIED, UNKNOWN). Nothing is invented: unknowns stay unknown.
  - **Thinnest groups:** the 305th (no primary records online), the 91st (site blocks automated access), the 379th and 381st (sites down or no sortie lists), the 388th (database needs an account), and the 94th and 96th (losses only).
- **In the game:**
  - **Identity panel:** I opens it for the bomber you're in: serial, type, name, group, squadron, code, pilot, what happened to her that day with the MACR, and her crew by station with each man's recorded fate and how sure the record is.
  - **Crew names:** crewmen are the real men where recorded, and marked placeholders where not.
  - **Historical outcomes (Options):** an off-by-default switch that weights the battle toward the recorded fates and sends recorded aborts home.
- **Developer tools and tests:**
  - **Inspection mode:** `?debug=formation` shows slots, leaders, offsets, station errors, numbers by group, and six camera views from the whole force down to one bomber and its neighbours.
  - **Tests:** `node tests/blackthursday.test.mjs` runs 3,149 checks covering counts, membership, slots, overlaps, record integrity and the charted places.
  - **Runtime:** stable station-keeping (median 5.7 m), no collisions at spawn, succession and straggling both working. 26 fps in the 291-bomber battle on this machine, with the historical layout no slower than the old one.
- **The rest of it (done since):**
  - **Markings:** each B-17 is painted from her record: the group's triangle or square on the fin, the tail number, the squadron code and letter, and her recorded name on the nose. Nothing is painted that isn't on record; nose art isn't drawn (not documented).
  - **Charted slots:** the 48 aircraft placed on the 303rd's, 306th's, 351st's and 384th's own formation charts fly in exactly those slots, each with the chart it comes from and how sure it is.
  - **The rally turn:** after the target the force turns from 58° to 130° over about a minute, banking about 12°, with the ground, sun, clouds and city all turning with it.
  - **Spoken names:** 1,782 new clips. Each named crewman (1,520 surnames) has a call by the co-pilot, each recorded pilot (182) a "They're going for X's ship!", and there are role calls ("Tail gunner's hit!", "We lost our radio operator.").
    - **First pass:** one take each.
    - **Second pass:** 143 clips with a stray word at the end or an overlong name were redone at 5 takes. The 8 still flagged are Whisper splitting a name into words ("Struck and Bruck"), not faults.
    - **Checked in the large battle:** all 1,782 load and decode. A tail-gunner hit played "hitRole_tail" then "name_Bomberger" (S/Sgt. Arthur Boyd Bomberger), with no fallback to the browser's voice.
    - **Not checked by ear:** Whisper often writes the "ship" of "going for X's ship" as "shit". Probably Whisper, but worth a listen.

## Formation, crew models, turret barrels, sound (follow-up)

- **Formation compressed so the whole battle is in view** (prompt: `hackathon/FORMATION_PROMPT.md`):
  - **Layout:** `src/oob.js` now flies `COMPACT_LAYOUT`. The order of battle, groups, squadrons, elements and the 48 charted slots are unchanged; only the distances shrank. The combat wings are about 1 km apart (they were 9 km), and the 3rd Division flies 1.25 km to the right (it was 48 km).
  - **Size:** the force is 2,183 × 748 × 3,263 m, with the closest pair 37 m apart and groups at least 186 m apart. `?spacing=historical` flies the old distances (`HISTORICAL_LAYOUT`).
  - **Fighters:** they fight the whole force for real, out to 4.2 km from you. A gaggle comes in on the group it picked. After a pass a fighter usually takes a bomber near where he is, and he runs out from the bomber he attacked. A third of the gaggles go for the groups round you. Escorts patrol round the whole force.
  - **Flak:** it fires on the whole force (6 batteries, up from 3), with the same share aimed at your bomber as before. The abstract far battle (`streambattle.js`) now only runs with historical spacing.
  - **Full real-time mission:** 55 of 291 lost (18.9%), spread over all 16 groups. 47 of them went down 500 m or more from you, most within 2.5 km, in view. There were 60 flak engine fires.
  - **Frame times (240 s of fighting, 1920×1080):** median 44–50 ms against 45 ms with historical spacing; 99% under 69–89 ms; 9–21 frames over 100 ms in about 5,000.
  - **Tests:** `node tests/blackthursday.test.mjs` passes 3,152 checks, with new ones for the compact box, the group clearance and the kept historical spacing.
  - **Screenshots:** `formation_waist_view.jpg` and `formation_waist_view2.jpg`.
  - **Not ideal:** the inspection mode's whole-force views are still framed for the 50 km historical spread, so in compact mode the bombers are dots.
- **Crew models rebuilt from research** (prompt: `hackathon/CREW_MODELS_PROMPT.md`; research: `hackathon/CREW_GEAR_RESEARCH.md`, sourced, every item rated VERIFIED, PROBABLE or UNVERIFIED):
  - **Body:** slimmed from the superhero base to a wiry 19–22-year-old's build, drawn in towards the bones with blended weights.
  - **Clothes by station, 14 Oct 1943:**
    - B-3 jacket and A-3 trousers for the waist and tail gunners;
    - the olive B-10 with its mouton collar for the bombardier, engineer and radio operator;
    - the A-2 for the pilots and the navigator;
    - the blue F-1 heated suit alone for the ball gunner.
    - The jackets end at the waist.
  - **Head:**
    - **Helmet:** the B-6, with its sheepskin lining turned out round the face. It replaces the 1944 A-11.
    - **Mask:** the A-10 Revised, its hose out of the chin. It replaces the 1944 A-14.
    - **Officers:** they wear helmets, not crush caps. The research found no dated October 1943 photo of a cap worn at altitude.
  - **Kit:**
    - **Harness:** plain olive drab (red markings only came in from May 1944). The leg straps are flat bands fitted to each thigh, replacing the floating rings.
    - **Mae West:** its collar is a round yellow roll round the back of the neck, not a flat patch.
    - **Flak vests:** the M1 in dark green with its red quick-release pull, on the waist gunners, radio operator and bombardier. The top and ball turret gunners have none.
  - **Lighting:** the crew catch more of the window light than the hull does, and the leather has a sheen, so a man seen from behind isn't a black shape. Stitched seams were added to the jackets' backs.
  - **Screenshots:**
    - `crew_turnaround.jpg`: every man front, back, three-quarter, head and in the bomber.
    - `waist_gunner_from_behind.jpg`: the view from your report.
    - `crew_b6_helmet_a10_mask.jpg`.
  - **Not done or not checked:**
    - The base mesh is still the same CC0 character, slimmed, not a new professionally modelled one.
    - The bail-out, wounded and dead poses were not re-checked after the slimming.
    - The ball gunner can't be seen in his turret, so he wasn't photographed.
    - Gloves are close to skin colour.
    - The research's colours are estimates.
- **Turret barrels:** the ball and top turret barrels are 70% of their old length (`models.js` `BARREL_K`). The shortening runs along each barrel from its end in the turret, on every B-17, and your own top turret's Brownings match. Screenshot: `turret_barrels.jpg`.
- **Sound:**
  - **Casings:** falling cases are 60% quieter, and the brass rolling on the floor chinks about a third as often and quieter.
  - **Flak:** it's heard from where you are (the camera), not from your bomber, and fades with distance (`exp(-d/1800)`). In a P-47 far off it's a distant rumble.
  - **Not checked by ear:** this was tested headless with no sound.
- **Nothing committed.**
- **Fighter calls trimmed:**
  - **Change:** "There's so many of them!" and "Here they come, a whole gaggle!" are gone. Every fighter call is just where they are ("Bandits, twelve o'clock high!"), including the first of the fight and a big new wave.
  - **Clips:** the 144 unused clips were moved out of `public/audio/voice` to `.voices/retired`, not deleted.
  - **Checked in game:** the first call of the fight played `bandits12_high` and nothing else.
- **New crewman (MPFB):**
  - **What changed:** the crew are now a realistic MPFB (MakeHuman for Blender, CC0) man: real face, eyes, brows and skin. His 1943 kit is modelled on his body in Blender and baked to textures (`scripts/crew/`, exported to `public/models/crew/crewman1943.glb`, about 17 MB):
    - B-3/A-3 sheepskins, B-10 with olive trousers, A-2, and the F-1 suit;
    - B-6 helmet, goggles, A-10 mask, A-6 boots and gloves;
    - harness, B-4 Mae West and M1 flak vest.
  - **Outfits:** each station shows its own outfit (`src/figure.js` OUTFITS).
  - **Mask:** a smooth moulded cup on an oval from the bridge of the nose, below the eyes, to under the chin. The face under it is removed, so nothing pokes through.
  - **Oxygen:** each man's mask hose clips to his harness, and a rubber hose hangs from there to the A-12 regulator at his post (`figure.js` oxygenLine, outlets from `interiordetail.js`). Away from every regulator he's off the line, as on a walk-around bottle.
  - **A-3 trousers:** the seat bridges the crease and moves with the pelvis, and the suede is darker and duller (it read as bare skin).
  - **Frames:** large battle, 46 fps, no frame over 100 ms.
  - **Screenshots:**
    - `crew_mpfb_turnaround.jpg`
    - `crew_mpfb_mask.jpg`
    - `crew_oxygen_hoses.jpg`
    - `crew_mpfb_waist.jpg`
  - **Not done or not checked:**
    - The bail-out, wounded and dead poses weren't photographed.
    - The ball gunner's F-1 can't be seen in his turret.
    - The old `crewman.glb` is still in `public/models/crew` but no longer loaded.
    - **Nothing committed.**
- **Crew, professional pass (`hackathon/CREW_PRO_MODEL_PROMPT.md`), built free rather than buying the £180 Fab pack:**
  - **Arms on the guns:** the men now stand where their hands fall on their grips. Each lean and step is worked out from the man's own arm length and each hand's distance to its own grip (`crew.js` FAR/NEAR). Measured shoulder to grip (`scripts/crew/t_arms.js`), every hand on its grip:
    - **Pilot:** right hand was 0.62 m (11 cm short), now 0.49 m.
    - **Navigator:** left hand was 0.72 m (21 cm short), now 0.58 m. He may step 45 cm toward the cheek gun.
    - **Radio:** was 0.17–0.26 m (arm folded flat into the gun), now 0.41–0.47 m. He no longer floats 26 cm off the floor to reach the hatch gun.
    - **Engineer:** now 0.29 m (was 0.22 m).
    - **Waist:** now 0.28–0.47 m.
    - **Pilots:** lean forward to the wheel and throttles, eyes kept ahead.
  - **Pilots' caps:** the pilot and co-pilot wear the officer's service cap, crushed, with:
    - a dark olive drab wool crown, low and soft, its sides pressed down by the headset;
    - a brown leather visor and chin strap with buttons, and the eagle;
    - an HS-38 headset over it (black Bakelite receivers in rubber cushions, a flat steel band over the crown, the cord);
    - short hair showing under it.
    Everyone else keeps the B-6 helmet and goggles (`figure.js` HEADGEAR, `crew.js` KIT `cap`).
  - **Mask:** dark olive rubber (it was pale green), with its own elastic head straps above and below the ears, a raised rubber lip round the edge, metal snaps and a metal hose fitting. The hose is corrugated, and so is the long hose to the regulator in the game.
  - **Materials:** CC0 scans from ambientCG (leather grain, sheepskin pile, wool, twill and canvas weave), tinted to the researched colours, with dirt baked into the creases (see `CREDITS.md`).
  - **Size and frames:** the crew download is 22.5 MB (was 17 MB). Large battle: 43 fps, no frame over 100 ms.
  - **Screenshots** (`hackathon/bug-shots/`):
    - `crew_pilot_cap_headset.jpg`
    - `crew_pilots_and_gunners_ingame.jpg`
    - `crew_hands_on_grips.jpg`
    - `crew_scanned_materials.jpg`
  - **Not done, honestly:**
    - The garments are still grown from the body's surface, not cut and sewn, and not sculpted then baked. Collars, cuffs and pockets are real, but there are no sewn seams or deep cloth folds. That is still short of the Fab reference's standard.
    - The Mae West and flak vest look flat up close.
    - The bail-out, wounded and dead poses weren't re-photographed.
    - The forearm-to-gun clipping was checked by eye in screenshots, not with a mesh-intersection test.
    - The cockpit lighting makes the A-2 read grey-blue.
    - **Nothing committed.**
- **Crew follow-up (your screenshots of the radio operator, the nose, and the top turret):**
  - **Radio operator's arms behind his head:** reaching up to the hatch gun, his elbows were bent back. When a grip is above the shoulder, the elbows now swing out and forward (`figure.js` reach), and the arms stay in front of him.
  - **Arms hidden by the harness and vest:** the harness, Mae West and flak vest near the armpit were weighted to the upper arm. Raising the arms to a gun pulled them into a sheet over the arm. They now move only with the spine and clavicles (`scripts/crew/bake_export.py` torso_only), and from behind the arms show at every gun.
  - **Top turret gunner:**
    - The green boxes are the Sperry turret's own ammunition cans, one either side of him. In your screenshot he was pressed into one, because the new reach code stepped him back from grips that are close to his chest. A turret gunner no longer steps.
    - He now wears the brown B-3 sheepskin over olive trousers instead of the olive cloth B-10.
  - **Two in the nose:** as bombardier or navigator, you see only the other one. Standing in the nose from another station, you see both, which is right for a B-17F.
  - **Frames:** large battle, 63 fps, no frame over 100 ms.
  - **Screenshots:** `crew_arms_from_behind.jpg`, `crew_top_turret_b3.jpg`.
