# Bf 109 G-6 cockpit: what's built (src/cockpit109.js)

**Variant.** In October 1943 the Jagdgeschwader over Schweinfurt flew the Bf 109 G-6. The game's outside
model is an F-2 (`models.js`), but the cockpit already had the G-6's "Beulen" over the MG 131s, so the
cockpit is a **G-6 as flown in autumn 1943**. That rules out the Erla Haube and the Galland-Panzer (both
arrived in early 1944), MW 50 (the G-6/AS and G-14 in 1944) and an artificial horizon (the G-6 had none).

**Colours.** RLM 66 Schwarzgrau throughout, worn to the primer where hands and boots rub; black
instrument faces with white luminous paint; the KG 13A grip black Bakelite; a brown leather stick boot,
khaki webbing harness, the yellow oxygen hose, the blue Höhenatmer.

## Canopy and armour
- The old framed hood (as on the F-2 outside): a flat roof pane, each side split by one horizontal bar,
  heavy frames in RLM 66 inside. Opens to the right: hinges on the right sill, the locking lever and the red
  jettison handle (Notabwurf) on the left.
- The windscreen with the 50 mm armoured glass front pane built in (green along its edges).
- The head armour (Kopfpanzer): an 8 mm steel plate with the rounded top, bolted to the hood behind
  your head.

## Instrument panel (two plates, shock-mounted upper, fixed lower; real holes, recessed faces, bezels, glass)
Upper: Feinhöhenmesser (altitude, two hands, the millibar window) · Wendezeiger (turn needle and slip
ball) · Ladedruckmesser (ata, red line 1.42) / Fahrtmesser (km/h) · Führertochterkompass (O for Ost) ·
Drehzahlmesser (U/min, red line 2800). The prop pitch "clock" (Luftschrauben-Stellungsanzeiger) top left.
The SZKK 4 ammunition counter on top left: one tape per gun, running down as you fire.
Lower: Kühlstoff and Öl temperatures, Doppeldruckmesser (Kraftstoff and Öl), Kraftstoffvorrat (Liter)
with the red low-fuel lamp, the gear lamps, the Zündschalter (M1+2), the fuel cock with its yellow handle.
Placards in German. At night the luminous paint glows (pilot.night), no lights added.

## Revi 16B
On its bracket on the panel's top centre: the body, the lamp housing, the reflector glass at eye level
(the reticle: pilot.js puts it on the guns' line), the sun filter folded down, the dimmer knob, the leather
crash pad. Reticle: ring, cross with a gap, centre dot.

## Controls
- KG 13A stick: Bakelite grip, the hinged MG trigger at the front, the cannon button under the thumb,
  leather boot; moves with stickX / stickY, gloved hand on it.
- Throttle on the left wall in its quadrant, the prop-pitch thumb rocker on the knob; moves with throttle.
- The two big wheels on the left wall: Höhenflosse (tail trim, white index) and Landeklappen (flaps).
- Right wall: the Selbstschalter (breaker) panel, the FuG 16Z box, the Höhenatmer and its yellow hose.
- Rudder pedals with straps, the grooved floor plates, the seat bucket, the harness over your chest.
