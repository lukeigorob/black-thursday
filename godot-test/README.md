# Black Thursday — Godot test

A small test of the game in the Godot engine (4.7.2), to compare with the browser version in `../src`.
Not part of the browser game; nothing in `../src` uses it.

**Play:** double-click `play.bat`. Mouse aims the left waist gun, left button fires, **C** switches to the
outside view (mouse orbits, wheel zooms), **Esc** frees the mouse.
**Edit:** `edit.bat` opens it in the Godot editor.

What's in it:
- the stream of 291 B-17s laid out as `../src/formation.js` lays it out; the ones within 150 m use the full
  model, the rest the low-detail model, one MultiMesh per material
- the left waist gun with the browser game's ballistics (890 m/s, gravity, drag, the air streaming aft)
- 24 Bf 109s making passes (mostly head-on from high), breaking away, smoking, burning, blowing up
- the other bombers' gunners firing back, flak bursts, bombers taking damage, smoking, falling out
- sky, haze, Franconian strip fields and woods in a shader, scattered cumulus below

What's not: the B-17's interior and crew, the cockpits, the mission, sound, the menus.

Files: `main.gd` (the scene, the formation, your gun, the test run), `fighters.gd`, `bullets.gd`,
`effects.gd`, and the shaders `ground`, `clouds`, `tracer`.

Test run (saves screenshots, prints frame times):
`Godot_v4.7.2-stable_win64_console.exe --path . -- --test --out=<folder>`
