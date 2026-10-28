# Prompt: research and rebuild the B-17 crew models to the highest standard (very important)

You're working on a WWII B-17 bomber game (three.js + Vite) in `C:\Users\Garre\Documents\bomber-game`, branch `b17-nose-crawlways-ball-turret`. The game is set on Black Thursday, the Schweinfurt raid of **14 October 1943**. Every crewman must be dressed and equipped as the Eighth Air Force flew that autumn, not as they did in 1944.

How to work:
- **Commits:** don't commit unless I ask.
- **Build:** `npx vite build`. Vite preview serves `dist` at http://127.0.0.1:4173.
- **Testing:** test in the large battle only (`?battle=large`). Use headless Chrome at 1920×1080, one browser at a time; the harness is `cdp.mjs` and the page exposes `window.game`. Keep frames under 100 ms.
- **Report:** tell me plainly what's done and what isn't, with screenshots.

**Spare no effort on this.** I want the crew to look as good as anything in a modern game, with no visual bugs. Take as long as it needs: research first, then design, then build, then check every station from every angle.

## The problem now

The crewmen look bad. Seen from behind at a waist gun, the man is:
- a featureless dark brown blob;
- with a flat yellow patch stuck on his back (the Mae West);
- with a grey ring floating round his legs (the harness or leg straps);
- with a helmet that reads as a bowl with a ring round it.

There's no visible clothing detail, seams, fleece, straps, oxygen hose or parachute, and the colours are wrong. Up close, the body shape is lumpy, too broad and gorilla-like.

## Read first

- **`src/figure.js`:** the current crewman.
  - Built on the Quaternius CC0 rigged base character in `public/models/crew/` (see CREDITS.md).
  - The clothes are pushed out from the body's own skin.
  - The gear (helmet, goggles, A-14 mask, Mae West, harness) is hung on the bones.
  - The officers have the A-2 jacket and a cap.
  - `pose()` and `syncFigures()` drive it.
- **`src/crew.js`:** who sits where, their poses at each station, wounds, deaths, bailing out, and the real names and ranks from the records (officer or enlisted).
- **`src/cabinlook.js`, `src/pilot.js`, `src/cockpit.js`:** what you see of the crew from each seat.
- **`historical_data/black_thursday/crew.json`:** the real men, with ranks and positions.

## 1. Research (do this properly, and write it up)

Write `hackathon/CREW_GEAR_RESEARCH.md`. Cite sources: museum collections (the National Museum of the USAF, the IWM, the American Air Museum in Britain), period photographs of 8th AF crews from summer and autumn 1943, AAF technical orders and specification sheets, and reputable reenactor and collector references. Give a confidence level for every item: VERIFIED, PROBABLE or UNVERIFIED. Find out, for October 1943 specifically:

- **Flying clothing:**
  - Sheepskin: the B-3 jacket and A-3 trousers.
  - Electrically heated suits: the F-1, and when the F-2 and F-3 arrived. What colour, and what was worn over them.
  - The A-2 leather jacket, and who wore it on a mission at 25,000 ft and −40°.
  - Coveralls, and what the waist gunners at the open windows wore versus the men in the warmer nose and cockpit.
- **Head:**
  - The A-11 (and earlier) leather helmets with their receivers.
  - The B-6 sheepskin helmet.
  - The officers' service cap ("50-mission crush" cap) with headset over it, worn by pilots in the cockpit in many photos. **Did pilots really fly in the cap at altitude?** Find out, and when.
  - The **steel helmets** (the M3 and M4 flak helmets, the modified M1). Were they issued by October 1943, and who wore them?
- **Oxygen:** the A-10, A-10 revised and **A-14** demand masks, their dates of issue, colours, hoses and the bayonet fittings to the regulator. Which one was in use on 14 Oct 1943, and how was it worn with each helmet?
- **Goggles:** the B-7, B-8 and AN6530: which ones, and worn up or down.
- **Hands and feet:** gloves (rayon inners, A-9/A-10 gauntlets, heated gloves) and boots (A-6, heated inserts).
- **Protection and survival:**
  - The **flak vest** (Flyer's Armor M1/M2, aprons): introduced when, and worn by whom (the waist gunners, the pilots). Colour and construction.
  - The **Mae West** (B-3 and B-4 life preservers): exact colour, shape, stencilling, how it sits on the chest, and whether it's seen from behind.
  - Parachutes: the **QAC chest pack** and harness (the A-3/A-4 harness, the chest pack clipped on or stowed), and the back packs worn by the pilots. Where each man kept his chute, and that the **ball turret gunner couldn't wear one** in the turret.
  - The throat microphone (T-30), the interphone cord and jack, the oxygen hose run.
- **Differences between men:**
  - Officers (pilot, co-pilot, navigator, bombardier) versus enlisted gunners: rank insignia, the cap, the jackets.
  - Each station's typical kit:
    - the radio operator at his table;
    - the engineer and top turret gunner;
    - the ball turret gunner, curled up in a small suit;
    - the waist gunners in the slipstream;
    - the tail gunner kneeling.
  - **Variety between men:** mixed kit, personal touches, the painted jacket backs (were these common in combat in 1943, or later?), scarves, and age and build. Find out what's documented; don't invent.
- **Faces and bodies:** typical ages (19–25 for the gunners), build, and how much of the face shows round the mask and goggles.

Then write a short **"what each man wears"** table, station by station, with the confidence levels. The build follows that table.

## 2. Design and build the best possible crewman

- **Approach:**
  - Choose the best approach and say why.
  - Options include a much better CC0 or properly licensed base character (check licences and credit them in CREDITS.md), properly modelled garments rather than pushed-out skin, normal and roughness maps, and baked detail.
  - Anything bought or downloaded must allow use in this game; record the licence.
  - Keep the existing rig contract (`userData.j` joints, `pose()`, `syncFigures()`) so `crew.js` keeps working, or update `crew.js` to match.
- **Required:**
  - **Correct proportions.** A real man in bulky flying gear, not a gorilla: shoulders, neck, the head size against the helmet, hands.
  - **Readable clothing materials:** sheepskin with real fleece at the collar, cuffs and seams; leather with sheen and wear; olive drab wool and twill; the webbing harness straps with metal hardware; the canvas of the Mae West in the right yellow, with its bladders, straps and stencilling.
  - **The gear modelled properly:**
    - the helmet with its chin strap and earphone cups;
    - goggles with lenses, frame and strap;
    - the oxygen mask with its hose running to the regulator or a bailout bottle;
    - the throat mic and interphone cord;
    - the flak vest where historically right;
    - the parachute harness with the D-rings and chest-pack clips;
    - gloves with fingers.
  - **Every man different** within what's documented:
    - rank and role (officers versus gunners, the pilot's cap only if the research supports it);
    - face, skin tone, build and height;
    - kit mixes per the table.
    - **Driven by the real crew records** where they exist: rank from `crew.json`.
  - **High-quality materials and lighting:**
    - PBR materials and proper shading under the cabin lights and the sun through the windows;
    - no flat, unlit or black blobs;
    - shadows, and correct dark-mode/night appearance.
  - **Seen from every angle:** your own crewmates from every seat (especially from behind at the waist guns, as in my screenshot), the pilots from the nose and the top turret, the men bailing out and falling, and the dead and wounded poses.
  - **No bugs:**
    - no floating rings, straps or patches;
    - no gaps or z-fighting;
    - no clipping through seats, guns, turret rings or the fuselage;
    - no stretched skin at the joints in any pose (aiming, reaching for ammunition, slumped wounded, bailing out);
    - no gear missing or doubled.
- **Performance:**
  - Ten men per bomber at full detail only in your own B-17.
  - Cheaper levels of detail for the neighbours' visible crew and the falling parachutists.
  - Keep frames under 100 ms in the 291-bomber battle.

## 3. Check it, and show me

- **Close screenshots of each of the ten stations:** front, back and three-quarter views, in daylight and in the cabin's own light.
- **A side-by-side of each man against a period photograph** of the same position (described with its source; don't reproduce copyrighted photos in the repo), listing anything that still differs.
- **The bail-out sequence and the wounded and dead poses,** with no clipping.
- **A frame-time comparison** before and after, in the large battle.
- **Updates to `hackathon/BUG_REPORT.md` and the top comment of `src/figure.js`,** saying what was researched, what was built, and what's still uncertain.
