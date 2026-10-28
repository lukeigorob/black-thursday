# Hackathon submission

## 1. Put the game online (free, HTTPS)

1. Go to **https://app.netlify.com/drop** and sign up (free; "Sign up with GitHub" or email is quickest).
2. Drag the **`dist`** folder from `Documents\bomber-game` onto the page (or the `b17-flying-fortress.zip`
   next to it). It uploads (36 MB, a minute or so) and gives you a link like
   `https://random-name-123.netlify.app`.
3. Give it a better name: **Site configuration → Change site name** → e.g. `b17-flying-fortress`
   → your link becomes **https://b17-flying-fortress.netlify.app**.
4. Open the link in Chrome or Edge and play a bit to check it.

To update it later: build again (`npx vite build`), then in Netlify **Deploys → drag the `dist` folder** onto the page.

## 2. The form

**Images** (in this folder, in this order):
1-fw190-attacking-the-stream.jpg · 2-tail-gunner.jpg · 3-b17-in-the-flak.jpg · 4-inside-the-b17.jpg · 5-pick-your-role.jpg

**Title**
B-17 Flying Fortress: a WW2 bomber game that runs in your browser

**What did you build and what happened?**
A 3D WW2 air battle that runs in the browser, no download. You're one of the ten men in a B-17 over
Germany in 1944, inside a stream of 54 bombers with 220 German fighters and the flak coming up at you.
Walk round the inside of the bomber and take any of its 13 guns (the ball turret, the top turret, the tail,
the waist), fly it from the pilot's seat, drop the bombs through the Norden sight, or patch up the wounded
crew. If she's going down, ring the bail-out bell, get to a hatch and pull your chute. You can also play the
other side: fly a Bf 109 or Fw 190 into the bomber boxes, or a P-51 escorting them.

Built with three.js and Vite, coded entirely with Claude Code (AI). What happened: it started as "a B-17
game" and grew one play-test at a time: a walkable interior with crawlways, crew who get wounded and can be
patched up, bombers that break apart, flak, a whole bomber stream whose losses play out across every group,
and real bullet ballistics. The hard parts were the things you don't notice when they work: hit boxes
measured from the model, smooth crawls through the tail, fighters that turn the way a pilot would.

**Live link**
https://b17-flying-fortress.netlify.app (whatever Netlify gives you)

**Video** (optional): a 30-second screen recording of a fighter attack from the tail gun works well.

**Tag:** App (or Website)
