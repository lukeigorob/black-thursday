# Archive audio: example clips

Ten short clips cut from two 1944 US Army Air Forces films. Each was levelled to -18 LUFS with short
fades; nothing else was changed. They are examples only and are not in the game.

## Sources and licences

**The Memphis Belle: A Story of a Flying Fortress (1944)**
- Made by the USAAF First Motion Picture Unit and directed by William Wyler. The B-17F *Memphis Belle*,
  324th Squadron, 91st Bomb Group, on the Wilhelmshaven raid of 15 May 1943.
- Copy used: archive.org/details/MemphisBelle (the 512 kb MP4), tagged Public Domain.
- National Archives: identifier 4523496 (local id 330-DVIC-26134). The catalog lists it as "Copyright Not
  Evaluated", but as a US government work it is public domain in the US.
- Caveat: the intercom track was assembled after the mission and may be partly re-enacted by the crew,
  so treat it as authentic in voice and vocabulary, not necessarily as live audio.

**Target for Today (1944)**
- A USAAF film of an 8th Air Force mission, played by 8th Air Force personnel: briefings, the mission,
  and the debrief after landing.
- Copy used: archive.org/details/gov.archives.arc.36776 (the 512 kb MP4), uploaded by the National
  Archives as ARC 36776 / 111-TF-3384 and licensed CC0.

**Left out:** CBS and BBC war broadcasts, such as Murrow's Lancaster recording and the "Wartime Radio"
collections on archive.org. Those networks still own them, whatever tag an uploader has given them.
Also left out: the "Fighting AAF" radio series (1945). It was dramatized, and its rights are unclear.

## Clips (time = position in the source film)

| File | Source, time | What's said |
|---|---|---|
| 01_belle_pilot_briefs_crew | Belle 5:45-6:11 | Morgan to his crew before take-off: "no escort except unfriendly... don't yell on the intercom" |
| 02_belle_clock_calls | Belle 24:24-25:15 | In combat: "four of them, one o'clock high", "breaking eleven", "I got him", "B-17 smoking, three o'clock" |
| 03_belle_b17_down_bail_out | Belle 25:26-25:57 | Watching a B-17 go down: "Get out of that plane, bail out... see any parachutes, Quinlan?" |
| 04_belle_got_him_dont_yell | Belle 25:57-26:40 | "I'm on him... I got him... damn it, don't yell on that intercom... get that ball turret on him... pull her up" |
| 05_belle_pilot_to_bombardier | Belle 21:00-21:06 | "Pilot to bombardier. Okay, Vin, you've got it." |
| 06_belle_oxygen_call | Belle 12:00-12:05 | "Pilot to crew, ten thousand, put on oxygen." |
| 07_target_wake_up_3am | Target 27:35-28:04 | Crews woken: "Three o'clock. This is a hell of a time to get a man out of bed." |
| 08_target_gunners_briefing | Target 42:55-43:30 | "Your biggest enemy is still the single-engine fighter plane." |
| 09_target_debrief_fighters | Target 1:23:15-1:24:23 | Gunners at the debrief describing the fighter attacks, rockets, a B-17 losing a wing |
| 10_target_debrief_two_down | Target 1:25:19-1:25:31 | "I knocked down two... five o'clock level... one blew up in the air" |

## voices_only/

The same ten clips with only the voices: the engines, wind and film score removed with Demucs (the
htdemucs_ft model, separating voice from everything else, run on the original soundtrack). Clips 07-10
were also given a light hiss reduction (ffmpeg afftdn). On the in-flight clips, the background between
words went from 4-8 dB below the voices to 60-90 dB below, which is silent. A few words that were buried
under the engines came out thinner: the start of 04 and "crew" in 06.

## In the game

Twenty-seven sentence-length clips (`voices_only/phrases/`) are in `public/audio/archive/`. `src/archive.js`
decides when each one plays. Clock calls play only when the fighters are at that o'clock.

`pilot_to_crew_bail_out_A.mp3` is made from two *Memphis Belle* clips: the pilot Robert Morgan's own
"Pilot to crew" from his oxygen call, then "Bail out!", called by another of the crew at a B-17 going down
in the same fight. Both were separated with Demucs `htdemucs`, which keeps "crew" clearer than
`htdemucs_ft` does. Neither the *Memphis Belle* nor *Target for Today* nor *Combat America* (1943,
archive.org CombatAm1945, public domain, also searched) has the bail-out order spoken in one take. The clip
asked for, from *Masters of the Air* (Apple TV+, 2024), is copyrighted and was left out.

## How they could go in the game

- Background chatter (clips 02-04): quietly, under the engines, during the fighter attacks, as other
  ships on the interphone. Narration is cut out; these stretches are crew voices only.
- Mission moments: 06 at 10,000 ft on the climb, 05 at the start of the bomb run, 01 and 07-08 on the
  loading screen or menu, 09-10 at the debrief after the mission.
- The game's own crew can't say these lines on cue, since the clock positions and names won't match
  what's happening on screen. So they fit as atmosphere, not as the crew's responses.
