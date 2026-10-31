# The waist, its guns and the gunners: what's built (spec)

## What the sources say

- **The gun (AN/M2 .50, flexible).** 1.43 m long overall, about 28 kg, with a 36 in (0.91 m) barrel
  inside a perforated cooling jacket and a muzzle booster. That leaves about 0.52 m of receiver and
  back plate. Behind the back plate are two spade grips with a butterfly trigger between them. The
  ring sight sits on the receiver and the post (bead) on the jacket. The belt feeds in from one side
  of the top cover, and the empty cases drop out of the bottom. (Wikipedia, *M2 Browning*;
  This Day in Aviation, TM 9-225.)
- **The mount.** The gun's trunnion (the front of the receiver) sits in an E-series recoil adapter,
  a spring buffer that lets the gun recoil within the mount. That adapter sits in a yoke on a
  swivel post (K-5 type) in the window. So the gun pivots in the window opening: the whole receiver
  and the gunner are inside, and only the jacket and barrel stick out. The adapter numbers aren't
  certain (E-8 and E-11 both appear in the sources).
- **Ammunition.** Boxes in the fuselage feed the gun through an articulated steel chute. Late
  B-17Fs carried tall 1943 boxes. One group's procedure limited each waist gun to 350 rounds.
  (hangarthirteen.org; 303rdbg.com, gunners' SOP.)
- **The window.** On the B-17F and the early G (October 1943), the waist windows were open. The
  window panel hinged up inside, and a wind deflector stood at the forward edge. The enclosed,
  staggered windows (the right one forward) came with the B-17G in 1944. The game already
  staggers the guns inside the model's opposite windows, as the brief asks, so that stays,
  slightly increased.
- **The waist itself** (the user's photos and surviving B-17s): bare formers and Z-section
  stringers, with the skin left bare or zinc chromate on the structure and olive drab on the panels.
  A plywood walkway has aluminium treads. Each gunner has an A-12 demand oxygen regulator with
  its blinker and gauge, and a BC-366 interphone jack box. There are yellow oxygen bottles, ammo
  boxes on racks, and the ball turret's drum and support column rising out of the floor to a beam
  under the roof. The radio-room bulkhead and its door are forward.

## What changes in the game

1. **Waist guns (browning.js, weapons.js).** The gun is set back so the pivot (the trunnion) is in
   the window: about 0.52 m of receiver inside and about 0.92 m of jacket and barrel outside. It
   is remodelled with:
   - the receiver's side plates, rivets and top cover with its latch;
   - the charging handle, back plate and buffer, and spade grips with the butterfly trigger;
   - the ring-and-post sight;
   - the trunnion block with an E-type recoil adapter;
   - a yoke that turns with the gun only in traverse, on a swivel post in a socket on the sill.

   The belt is fed by a flexible articulated chute, updated each frame, from the ammo box on its
   wall rack to the feed tray. A canvas spent-case bag hangs under the receiver. The hinged window
   panel is swung up and latched under the roof, the window has a frame round its opening, and
   the wind deflector sits at its forward edge outside.
2. **Waist interior (new src/waist.js).** Dense Z-section stringers in zinc chromate and bare skin
   between the frames. An A-12 regulator and a BC-366 jack box at each gunner, with their oxygen
   outlets moved there, so the men's hoses go to them. Ammo boxes with lids, latches and handles,
   on racks. The walkway with aluminium treads. Armour plate under each window. The ball turret's
   drum, azimuth crank and support column up to a beam under the roof. The radio-room door
   standing open on its hinges.
3. **Gunners (crew.js, figure.js).** Instead of the fixed pose, a body solver works from the gun:
   - The eyes go on the sight line behind the ring, with the head pitched to it.
   - The torso leans to bring the head there. The knees bend to set the height, in a staggered
     stance with the feet planted on the floor (two-bone leg IK, feet flat). He steps when the gun
     swings far enough that a foot is left behind, and the body turns with the gun.
   - The hands are on the grips (arm IK as before).
   - Idle: breathing, small shifts of weight, and the head scanning the sky between bursts.
   - Recoil: a rhythmic kick at the gun's rate of fire, through the shoulders and head.

   This applies to the waist gunners and the radio gunner. The radio gun's pivot comes down to
   just under the hatch, so his grips are above his head with his arms bent and his head tilted
   back to the sight, instead of his arms straight up. The top turret, tail, nose and cheek men
   get the idle and recoil motion and are reviewed in screenshots.
