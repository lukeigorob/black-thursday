# Credits

Third-party assets used in the game. All are free to use; none needs attribution, but they're
credited here anyway.

| File | What | Source | Licence |
| --- | --- | --- | --- |
| `public/models/crew/crewman1943.glb` | The crewman: a body made with MPFB 2 (MakeHuman for Blender), using its CC0 system assets, the skins02, eyebrows01 and eyelashes01 packs, and its "game engine" rig. His 1943 flight gear (B-3/A-3 sheepskins, B-10, A-2, F-1, A-6 boots, B-6 helmet, A-10 mask, B-4 Mae West, harness, M1 flak vest) is modelled on him and baked to textures by `scripts/crew/`. | [static.makehumancommunity.org/mpfb.html](https://static.makehumancommunity.org/mpfb.html) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) (assets; the MPFB tool itself is GPL, but nothing of it ships) |
| `public/models/crew/crewman1943.glb` (hair) | MakeHuman "short02" hair (system assets), shown under the pilots' caps. | [static.makehumancommunity.org](https://static.makehumancommunity.org/assets/assetdownloads.html) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/models/crew/crewman1943.glb` (eyes, skin) | MakeHuman's "blue" eye texture (system assets), and the normal map of "Aksel" skin by Mindfront (skins02 pack) for the face's pores and fine lines. `scripts/crew/` reads them as `blue_eye.png` and `Aksel_Skin_NRM.png`. | [makehumancommunity.org/node/850](http://www.makehumancommunity.org/node/850) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/models/crew/crewman1943.glb` (gear textures) | The surfaces baked into the gear's textures: Leather 037 (jackets, helmets, boots, gloves, cap visor), Carpet 016 (the sheepskin pile), Fabric 032 (wool: the F-1 suit, the cap), Fabric 036 (twill), Fabric 030 (canvas: Mae West, flak vest). `scripts/crew/crewmats.py` reads them from `scripts/crew/cc0/<name>/` (the 2K JPG sets, not in git). | [ambientCG.com](https://ambientcg.com) | [CC0 1.0](https://docs.ambientcg.com/license/) |
| `public/models/crew/crewman.glb` | The old crewman body (no longer loaded): "Superhero_Male_FullBody" from the Universal Base Characters pack, by Quaternius. | [quaternius.itch.io/universal-base-characters](https://quaternius.itch.io/universal-base-characters) | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/textures/paint_*.jpg` | Painted Metal 006 (colour, normal, roughness) | [ambientCG.com](https://ambientcg.com/view?id=PaintedMetal006) | [CC0 1.0](https://docs.ambientcg.com/license/) |
| `public/textures/planks_*.jpg` | Planks 037 A (colour, normal) | [ambientCG.com](https://ambientcg.com/view?id=Planks037A) | [CC0 1.0](https://docs.ambientcg.com/license/) |
| `public/textures/leather_*.jpg` | Leather 038 (colour, normal) | [ambientCG.com](https://ambientcg.com/view?id=Leather038) | [CC0 1.0](https://docs.ambientcg.com/license/) |

The aircraft models (`public/models/*.glb`) were in the project before these were added.
