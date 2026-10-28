# Prompt: pull the formation together so the whole battle is in view (very important)

You're working on a WWII B-17 bomber game (three.js + Vite) in `C:\Users\Garre\Documents\bomber-game`, branch `b17-nose-crawlways-ball-turret`. The game is set on Black Thursday, the Schweinfurt raid of 14 October 1943: 291 B-17s.

How to work:
- **Commits:** don't commit unless I ask.
- **Build:** `npx vite build`. Vite preview serves `dist` at http://127.0.0.1:4173.
- **Testing:**
  - Test only in the large battle (`?battle=large`, all 291 bombers). There is no small battle any more.
  - Use headless Chrome at 1920×1080, one browser at a time. The harness is `cdp.mjs` (`BATTLE=large WS=1920,1080 node cdp.mjs test.js`). The page exposes `window.game`.
  - Keep frames under 100 ms.
- **Report:** tell me plainly what works and what doesn't, with screenshots.

## The problem

The formation is laid out at historical spacing, and in the game that's far too spread out. You see your own group and almost nothing else. The German fighters only attack the bombers near you. The rest of the 291 are tiny dots or out of sight, and their battle runs as an invisible simulation. You get no sense of the scale of the raid.

I want the formation **much tighter**, so that:
- the whole force, or at least most of it, is visible around you as one big mass of bombers;
- the enemy fighters visibly attack groups all through the formation, not just yours;
- you can look out of any window and see bombers being hit, burning, going down and parachutes coming out, all around you.

Gameplay and spectacle come first here, not the exact historical distances. Keep the historical *structure*: the order of battle, the groups, the squadrons, the elements, the lead/high/low arrangement, the charted slots and every aircraft's identity. Only the distances get smaller.

## Where the spacing comes from (read these first)

- **`src/oob.js`:** `LAYOUT` holds every distance in one place. Offsets are metres: x right, y up, z back.
  - **`element`:** wingmen 47 m out and 38 m back. Fine as it is.
  - **`squadron`:** the second element 76 m back. Fine.
  - **`group`:** high and low squadrons ±100 m to the side, 120 m back.
  - **`wing`:** the high and low groups ±250 m to the side, 305 m up or down, 400 m and 800 m back.
  - **`wingInterval: 120` s:** each combat wing trails the one ahead by 120 s × 75 m/s = **9 km**. This is the biggest problem.
  - **`divisionLateral: 48300` m:** the 3rd Air Division flies **48 km** to the side of the 1st, completely out of sight. This is the other big problem.
- **`src/formation.js`:** `historicalSlots()` turns those slots into bomber positions for the large battle.
- **`src/fighters.js`:**
  - `nearBombers()` keeps only the bombers within **1,300 m** of yours. The fighters pick their targets from that list.
  - `FarFighters` handles the fighters drawn far away.
- **`src/streambattle.js`:** the abstract battle for every group beyond `REAL = 1500` m. It handles fighter passes and flak by group, plus loss governors. This is why the far battle can't be seen.
- **`src/main.js`:**
  - The loss steering: `LOSS_GOAL` (about 20%), `lossBias` and `groupBias`.
  - The rally turn (`rallyTurn`).
  - Where `FormationDebug` hooks in.
- **`src/formationdebug.js`:** `?debug=formation` gives a whole-force view and a report of the spacing. Use it to check the new layout.
- **`src/world.js`:** fog and view distance (how far you can see).
- **`src/models.js` / `src/bomber.js`:** the model detail levels (full, mid and far) for the bombers.
- **`tests/blackthursday.test.mjs`:** checks the counts, slots and overlaps. It requires no two aircraft closer than 31.6 m at spawn. Keep it passing.

## What to do

1. **Compress the layout.** Suggested starting point; tune it by eye in the game:
   - The combat wings trail each other by about **600–900 m**, not 9 km. Set it in metres, not as a time.
   - The 3rd Air Division flies alongside the 1st, about **1–1.5 km** to the right, not 48 km.
   - Wing spacing: high and low groups about ±150 m to the side, ±150 m up or down, 250 m and 500 m back. Keep enough vertical separation so groups never overlap.
   - Element, squadron and group spacing can stay as they are, or tighten slightly if it still looks loose.
   - Goal: the whole 291-bomber force fits in a box about **2–3 km wide, 4–6 km long and 600–800 m tall**. From the middle you should see bombers in every direction.
   - Keep the historical numbers in comments (or a `HISTORICAL_LAYOUT` constant) so they're not lost. Optionally offer them as a menu option, off by default.
2. **Let the fighters attack the whole formation for real.**
   - Widen the real-battle radius (`nearBombers` 1,300 m, `REAL` 1,500 m) so the fighters pick and attack targets across all the visible groups. Their attacks, tracers, hits, fires, smoke trails and break-ups should happen in view.
   - Spread the 100 Fw 190s and Bf 109s across the formation. Some should be on your group, but you should see attacks going in on groups ahead, behind and to the sides.
   - Keep `streambattle.js` only for whatever is still too far to see, or retire it if everything's now in range. The losses must still land near **20%** (`LOSS_GOAL`) with the losses spread down the stream: the low groups and trailing wings hit hardest, mostly from engine fires.
3. **Make it look like a big battle.**
   - Check the fog and view distance in `world.js`, so the far end of the formation is hazy but visible.
   - Check that the far bomber models and far fighters still read as aircraft at 2–4 km, not single pixels.
   - Make bombers going down, smoke trails, flak bursts and parachutes visible across the formation, not only right next to you.
4. **Keep everything else working:**
   - The charted slots (48 aircraft in their groups' recorded positions).
   - The markings and the identity panel (I).
   - Succession when a leader goes down, stragglers dropping out, aborts turning back.
   - The rally turn after the target. Check the whole formation turns together without groups crossing through each other now that they're closer.
   - The flak, the bombing run and the target, the P-47 escort (leaving for fuel) and the playable P-47.
   - `node tests/blackthursday.test.mjs` passes. Update its spacing checks if needed, and add one that the force fits the target box.
5. **Performance:** 291 bombers plus 100 fighters fighting in view is a lot more work than before. Profile it. Keep frames under 100 ms and as close to the old frame rate as you can:
   - level of detail;
   - instancing for far bombers;
   - cheaper far fighters;
   - fewer particles far away;
   - spreading the fighters' AI updates over frames.

## Done means

- Screenshots from your seat (the pilot, a waist window, the tail) showing the formation as a big mass of bombers in every direction, with fighters attacking groups other than yours.
- A `?debug=formation` whole-force screenshot and its spacing report: the box size and the closest pair.
- One full large-battle mission, with:
  - losses near 20%, spread by group, with what caused them;
  - frame times (median and worst);
  - confirmation that the turn and the bombing still work.
- The tests passing.
- An update to `hackathon/BUG_REPORT.md` and the layout section of `BLACK_THURSDAY_RESEARCH.md`, saying the spacing is compressed for gameplay and keeping the historical values.
