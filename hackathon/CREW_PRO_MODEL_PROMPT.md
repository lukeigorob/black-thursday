# Prompt: professional-quality B-17 crewmen, officers' caps for the pilots, and arms that hold the guns (very important)

You're working on a WWII B-17 bomber game (three.js + Vite) in `C:\Users\Garre\Documents\bomber-game`, branch `b17-nose-crawlways-ball-turret`. The game is set on Black Thursday, the Schweinfurt raid of **14 October 1943**.

How to work:
- **Commits:** don't commit unless I ask.
- **Build:** `npx vite build`. Vite preview serves `dist` at http://127.0.0.1:4173.
- **Testing:** test in the large battle only (`BATTLE=large`; there is no small battle any more). Use headless Chrome at 1920×1080, one browser at a time; the harness is `cdp.mjs` and the page exposes `window.game`. Keep frames under 100 ms.
- **Report:** tell me plainly what's done and what isn't, with screenshots.

**Spare no effort.** Research first, then design, then build, then check every station from every angle. Don't call it done until the crew stand up next to the reference below.

## The bar: what "professional" means here

The reference is RetroStyle Games' "WW2 Pilots Collection" on Fab (https://www.fab.com/listings/31ce7018-a57e-4b6e-b3e3-9421c83cf1c8, £180, Standard licence). Its USAAF pilot has:
- **Sculpted gear:** a high-poly sculpt baked to a game mesh. Every piece reads as a real object with real thickness and edges, not as skin pushed outwards:
  - the leather helmet with its seams and stitched panels;
  - goggles with a padded frame, a strap and glossy lenses;
  - a moulded rubber mask with straps, buckles and fittings;
  - a corrugated (ribbed) oxygen hose;
  - a jacket with its collar, plackets and seams;
  - fabric with large-scale folds where it bunches and creases.
- **PBR materials:** albedo, normal, roughness and metalness at 2048², with leather, rubber, wool, canvas, metal and glass each clearly itself: grain, wear on the edges, dirt in the creases, sheen on rubber and lenses.
- **Rig:** it's on the Epic (UE Mannequin) skeleton, which uses the same bone names as our MPFB `game_engine` rig.

Our crewman now (`public/models/crew/crewman1943.glb`, built by `scripts/crew/`) is the MPFB CC0 body with gear grown out of the skin surface and procedural textures baked on. That method has hit its ceiling:
- garments have no edges or construction;
- the mask is a smooth blob, and the hose is a plain black tube;
- folds are sine ripples;
- the leather looks like skin.

**I've said these models still look bad. Fix the method, not the details.**

## Decide first: buy or build (ask me before spending anything)

1. **Buy the reference pack (£180).** Before recommending it, check:
   - **Licence:** the Fab Standard licence allows use in a game. Find out whether the raw files may sit in this git repo, and whether the repo is public. If it is public, the source assets must stay out of git and only ship inside the build.
   - **Contents:** whether it includes the USAAF *bomber* pilot (it lists one) and enlisted-style gear. It has no B-3/A-3 sheepskins, no flak vests and no Mae Wests for gunners, so say what's missing for the other eight men.
   - **Conversion:** converting FBX to GLB, its textures to KTX2 or JPEG, and a budget for ten men on screen.
   **Do not buy anything.** Present it to me with the price and what it covers.
2. **Build it to that standard, free.** In Blender, on the MPFB body we already have (it's good):
   - **Model each garment as a garment**, not a skin offset: pattern pieces, or a clean retopo over a cloth simulation (Blender cloth on the posed body, then retopologised), with real thickness, hems, seams and collars.
   - **Sculpt the detail at high poly**, then bake normals and AO onto a 15–25k-triangle game mesh per outfit:
     - folds at elbows, shoulders, crotch and knees;
     - stitching and leather grain;
     - fleece pile on the B-3 collar and cuffs;
     - the ribbed hose;
     - buckles and snaps.
   - **Texture with real PBR**: CC0 scans from ambientCG or Poly Haven for leather, sheepskin, wool, canvas and rubber, plus hand-painted wear, at 2048² for the big pieces.
   - **Free models:** look again for free CC0/CC-BY game-ready WWII gear, such as Sketchfab "downloadable" items with a licence that allows games, BlendSwap, or Poly Haven. Mask, goggles, headset and helmet are the likeliest. Use them where they're good enough, credit them in `CREDITS.md`, and never use a non-commercial or editorial licence.

Recommend one route with reasons, then do it once I agree.

## Pilots wear officers' caps

The research (`hackathon/CREW_GEAR_RESEARCH.md`, section 2) says the 303rd BG photographed pilots in their first year in England wearing the officer's service cap with its stiffener taken out (the "50-mission crush") and an HS-33/HS-38 headset over it. The A-10 Revised mask hangs from its own elastic head straps, so it can be worn with the cap.

- **Pilot and co-pilot:** a crushed officer's service cap with:
  - an olive drab or dark green wool crown, soft and dented where the headset presses it;
  - a brown leather visor and chin strap;
  - the gilt officer's eagle badge on the front;
  - an HS-38 headset over it, with black receivers in rubber cushions on a sprung band and its cord down the back;
  - the A-10R mask on its head straps, worn over the nose and mouth or hanging under the chin.
  - **Jacket:** an A-2 (seal-brown horsehide, knit cuffs and waist, epaulettes).
- **Navigator and bombardier (officers):** B-6 helmets (the nose is cold). They could have caps too; choose from the research and say why.
- **Enlisted men:** B-6 sheepskin helmets, as now.

Officers and enlisted should look different at a glance, as the research says they did.

## The arms disappear on the guns (measured)

I measured each gunner in the large battle. In `src/figure.js` the arms reach the grips by two-bone IK. Each arm is 0.50 m from shoulder to wrist (0.46 m for the waist gunners, who are scaled to 0.92).

| Station | Shoulder to grip (m) | Hand short of grip | What you see |
| --- | --- | --- | --- |
| Pilot, right hand | 0.62 | 11.5 cm | Arm straight and hanging short of the wheel |
| Navigator, left hand | 0.72 | 21 cm | Arm straight and hanging short of his gun |
| Engineer, both hands | 0.22 | — | Elbows folded flat: forearms buried in the turret guns |
| Radio, both hands | 0.17–0.26 | — | Same |
| Waist and the rest | 0.27–0.52 | — | Reach, but forearms pass into the receivers |

Fix it properly:
- **Stand each man where his hands fall naturally on his grips.** The shoulder-to-grip distance should be about 55–90% of his arm, with the elbows bent and down. Move and turn the figure, its stance and its torso lean per station. Don't stretch or shrink the arm.
- **Grips:**
  - Spade grips on the .50s are held with the thumbs on the butterfly trigger.
  - The pilots' control wheel is held at the horns.
  - The top turret and ball turret hand grips are held as Sperry made them.
  - The hands must close round the real grip geometry, outside it: knuckles visible, no fingers through metal.
- **No interpenetration:** no forearm, sleeve or glove inside a gun, mount, ammunition chute or turret. Check with a mesh-intersection test, not just by eye.
- **Sleeves on bent elbows:** sleeves must not collapse or vanish. Add forearm and upper-arm twist weighting, a corrective shape or helper for the elbow, and make sure the jacket follows the arm.
- **Measured check:** for every station, log hand-to-grip (target under 2 cm from the palm to the grip) and the elbow angle, as `scratchpad/t_arms.js` does now.

## Keep

- The skeleton bone names `src/figure.js` drives (`pelvis`, `spine_01–03`, `neck_01`, `Head`, `clavicle`, `upperarm`, `lowerarm`, `hand`, fingers, `thigh`, `calf`, `foot`).
- `makeRig`/`syncFigures`, `reachFor`/`grip`, and the poses in `src/crew.js`: bail-out, wounded and dead.
- The outfits per station (`OUTFITS` and `KIT` in `src/crew.js`).
- The face removed under the mask.
- The oxygen line to the A-12 regulator at each post (`oxygenLine` in `src/figure.js`, outlets in `src/interiordetail.js`). Run it from the new mask's hose fitting.
- Your own body (`opts.self`): no head, and no chest kit round your eyes.

## Budget

- **Mesh:** ten men on screen at once. Aim for 40–60k triangles per dressed man.
- **Textures:** shared texture sets, compressed (KTX2/Basis if the loader is wired up, otherwise JPEG). Total crew download under about 25 MB.
- **Load time:** the "Forming up" stage on the loading screen now takes 10–25 s; don't make it worse.
- **Frames:** stay under 100 ms per frame in the large battle.

## Done means

1. A side-by-side screenshot of our pilot next to the reference image, at the same angle and lighting, that holds up.
2. Every station, front, back, three-quarter and face (`scratchpad/t_crew.js`), plus the in-bomber view from your own seat: no blobs, no skin-like leather, no seams that open, no clipping.
3. The pilots in crushed caps with headsets; everyone else per the research.
4. Every gunner's hands on his grips, measured, with screenshots from the gun position and from beside the gun.
5. The bail-out, wounded and dead poses re-checked.
6. `CREDITS.md` updated for every asset and texture; the Blender scripts in `scripts/crew/`; a section in `hackathon/BUG_REPORT.md` with screenshots in `hackathon/bug-shots/`.
7. Frame times in the large battle, and the crew download size.
