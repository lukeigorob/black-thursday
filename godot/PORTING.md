# Porting Black Thursday to Godot

The goal: **the same game, every feature, the same feel, and better where Godot makes it better.** The browser
game in `../src` is the reference for everything. Port it; don't redesign it.

Godot 4.7.2: `C:\Users\Garre\Tools\godot\Godot_v4.7.2-stable_win64_console.exe` (the `_console` one prints to
the terminal; the other is the editor/game without a console).

## The layout

- `src/<name>.gd` is the port of `../src/<name>.js`. One file each, the same name, so anyone can find
  the counterpart. (`menus.css` becomes Godot Controls and themes in `src/ui.gd` and `ui/`.)
- `src/core/`: shared helpers (below). Owned by the coordinating session; if you need a change or an addition
  there, message it rather than editing.
- `models/`, `audio/`, `textures/`, `loading/`: the web game's `public/` files, at the same paths, so a URL in
  the JS like `models/b17.glb` is `res://models/b17.glb`.
- `tests/<area>/`: each area's test scenes.
- `main.gd`: the port of `main.js`, done last, when the areas are in.

## How to port a file

- **Keep everything**: every number, every behaviour, the order things happen in, and the comments (they carry
  the history and the reasons; port them along with the code, adjusting only where the Godot code differs).
- **Names**: camelCase becomes snake_case for functions, variables and fields (`updateBody` → `update_body`,
  `this.waistParts` → `waist_parts`); UPPER_CASE constants and PascalCase classes stay as they are.
- **Modules**: a JS module becomes a script; other files load it with
  `const Bomber := preload("res://src/bomber.gd")`. Exported functions become `static func`, exported
  constants `const` (or `static var` when computed at load). A module exporting several classes keeps
  the main one as the script and the rest as inner classes (`formation.gd` → `Formation.Fleet.new()`).
  No `class_name` (it clashes with Godot's own classes and needs the editor to register).
- **Cross-area calls**: call other modules by their ported names, as the JS calls them, even if that file
  isn't ported yet; the other session ports the same names. To test before it exists, put a small stand-in
  in your own `tests/<area>/` folder. Never edit another area's files; if you need something from one, message
  its session (ids below) or the coordinating session.
- **Better, not different**: an improvement is welcome where it doesn't change what the game does or what it
  means to look like: Godot's shadows, SSAO and glow instead of hand-made passes, GPU particles instead of
  CPU ones, sharper textures. List every deliberate difference in your report.

## Three.js → Godot

The coordinate system is the same: Y up, metres, -Z forward (the bombers' noses face -Z in both). Numbers
carry over unchanged.

| Three.js | Godot |
|---|---|
| `Group`, `Object3D` | `Node3D` |
| `Mesh(geometry, material)` | `MeshInstance3D` with `mesh = geo.to_mesh()` |
| `XxxGeometry(...)`, `.translate/.rotateX/...`, `mergeGeometries` | `Geo.xxx(...)`, same chain, `Geo.merge` (`src/core/geo.gd`) |
| `Shape`, `Path`, `CatmullRomCurve3` | `src/core/shapes.gd` |
| `MeshStandardMaterial({...})` and friends | `Mat.standard({...})`, `Mat.physical`, `Mat.basic`, `Mat.lambert` (`src/core/mat.gd`, the same option names) |
| canvas `getContext('2d')` + `CanvasTexture` | `Canvas2D.new(w, h)`, the same calls in snake_case, `.texture()` (`src/core/canvas2d.gd`) |
| `onBeforeCompile`, `ShaderMaterial` | a `ShaderMaterial` with a Godot shader (`.gdshader`) doing the same |
| `InstancedMesh` | `MultiMeshInstance3D` (`set_instance_transform`, `set_instance_color`) |
| `Sprite`, `Points` | a billboard quad / `MultiMesh`, or particles |
| `Vector3`, `Quaternion`, `Color` | the built-ins (`Quaternion(axis, angle)` = `setFromAxisAngle`) |
| `Matrix4` | `Transform3D` (`Basis` for rotation-only) |
| `Box3`, `Sphere`, `Raycaster` | `AABB`, a centre and radius, `PhysicsRayQueryParameters3D` or plain maths |
| `CubeCamera`, `PMREMGenerator` | `ReflectionProbe` |
| `WebGLRenderTarget` | `SubViewport` |
| `PointLight`, `DirectionalLight` | `OmniLight3D`, `DirectionalLight3D` (light units differ: match the look) |
| `localStorage` | `src/core/store.gd` (`Store.get_item`, `Store.set_item`, same keys) |
| `?param` in the link | `src/core/args.gd` (`Args.param("battle")`; on the command line `-- --battle=small`) |
| `performance.now()` | `Time.get_ticks_usec() / 1000.0` |
| `Math.random()` | `randf()` |
| DOM, CSS | `Control` nodes, `Theme` |
| keyboard and mouse events, pointer lock | `_input` / `_unhandled_input`, `Input.mouse_mode = MOUSE_MODE_CAPTURED` |
| Web Audio nodes | `AudioStreamPlayer` / `AudioStreamPlayer3D`, `AudioStreamGenerator`, or sounds generated into an `AudioStreamWAV` once |
| GLTFLoader | `load("res://models/x.glb")` → a `PackedScene`, `.instantiate()` |

### The geometry API (`src/core/geo.gd`, `src/core/shapes.gd`; in, checked against Three to 1e-5 on 60 cases)

Notes from building it: `torus` also takes Three's `theta_start, theta_length`; `from_arrays` takes colours after
the indices; Three's base `Curve` is `Shapes.CurveBase` (Godot has a `Curve`); custom attributes also via
`set_custom(slot, data, size)`, others via `set_attribute(name, data, item_size)`; `rounded_box` is the
RoundedBoxGeometry addon. **Closed CatmullRomCurve3**: pass points as `[x, y, z]` arrays, not Vector3s
(Godot's Vector3 is float32 and a closed curve is sensitive to it; arrays keep doubles and match Three exactly).
`to_mesh` flips v for Three's flipY textures (image and canvas textures); a texture Three loads with flipY false
(DataTexture, glTF maps) on a code-built mesh would come out upside down: flip that one back.

`const Geo := preload("res://src/core/geo.gd")`. Every factory takes Three's parameters in Three's order with
Three's defaults, and gives Three's vertices in Three's order:
`Geo.box(w, h, d, ws, hs, ds)`, `Geo.rounded_box(w, h, d, segments, radius)`, `Geo.plane(w, h, ws, hs)`,
`Geo.circle(r, segments, theta_start, theta_length)`, `Geo.ring(...)`,
`Geo.cylinder(rt, rb, h, radial, height_seg, open_ended, theta_start, theta_length)`, `Geo.cone(...)`,
`Geo.sphere(r, ws, hs, phi_start, phi_length, theta_start, theta_length)`, `Geo.torus(r, tube, radial, tubular, arc)`,
`Geo.capsule(...)`, `Geo.lathe(points, segments, phi_start, phi_length)`, `Geo.shape(shapes, curve_segments)`,
`Geo.extrude(shapes, {depth = .., bevelEnabled = .., bevelThickness = .., bevelSize = .., bevelSegments = .., curveSegments = .., steps = ..})`
(the options dictionary keeps Three's camelCase keys), `Geo.tube(path, tubular_segments, radius, radial_segments, closed)`,
`Geo.from_arrays(positions, normals, uvs, indices)`.
Chain methods return the Geo: `translate(x, y, z)`, `rotate_x(a)`, `rotate_y(a)`, `rotate_z(a)`, `scale(x, y, z)`,
`apply_transform(t: Transform3D)` (= applyMatrix4), `apply_quaternion(q)`, `compute_vertex_normals()`,
`to_non_indexed()`, `clone()`. `Geo.merge(geos, use_groups := false)` = mergeGeometries.
Raw data: `geo.positions` (PackedVector3Array), `geo.normals`, `geo.uvs` (PackedVector2Array), `geo.colors`
(PackedColorArray, optional), `geo.indices` (PackedInt32Array, empty = non-indexed), `geo.groups`; edit them in
place as the JS edits attributes. Custom per-vertex attributes (Three's `setAttribute('aEdge', ...)`):
`geo.custom[0..3]` (PackedFloat32Array, 1-4 floats a vertex, `geo.custom_size[i]`), reaching the shader as
`CUSTOM0`..`CUSTOM3`. `geo.to_mesh(materials = null) -> ArrayMesh` (one surface per group).
Shapes (`const Shapes := preload("res://src/core/shapes.gd")`): `Shapes.Shape.new(points := [])`, `Shapes.Path`,
with `move_to`, `line_to`, `quadratic_curve_to`, `bezier_curve_to`, `spline_thru`, `arc`, `absarc`, `ellipse`,
`absellipse`, `holes` (Array), `get_points(divisions)`, `get_spaced_points`; `Shapes.CatmullRomCurve3.new(points,
closed, curve_type, tension)` with `get_point(t)`, `get_point_at(u)`, `get_tangent_at(u)`, `get_points(n)`.

The canvas painter (`src/core/canvas2d.gd`; arriving): `var c := Canvas2D.new(w, h)`, then the canvas 2D API in
snake_case (`c.fill_style = "#3a3a2a"`, `c.begin_path()`, `c.arc(...)`, `c.fill()`, `c.font = "bold 20px sans-serif"`,
`c.fill_text(...)`, gradients, `save`/`restore`, transforms, `clip`, `shadow_blur`...); `c.texture()` returns an
`ImageTexture` at once that fills itself when the frame renders; `await c.image()` for the pixels.

Traps:
- **Euler order**: Three's `rotation` is XYZ; Godot's `Node3D.rotation` is YXZ by default. Set
  `node.rotation_order = EULER_ORDER_XYZ` wherever the JS sets `.rotation` from angles, and use
  `Basis.from_euler(v, EULER_ORDER_XYZ)` for `new Euler(...)`.
- **lookAt**: Three's `Object3D.lookAt` points an object's **+Z** at the target (only cameras and lights point
  -Z). Godot's `look_at` points -Z. Port `obj.lookAt(t)` as `obj.look_at(2 * obj.global_position - t)` or
  build the basis yourself.
- **Winding and UVs**: `Geo.to_mesh()` already turns Three's counter-clockwise triangles to Godot's clockwise
  and flips the texture v so images land the same way up. Meshes you build by hand must do the same.
- **Units of light**: Three's light intensities and Godot's energies aren't the same scale. Match by eye
  against the web game's screenshots, not by copying the numbers.
- **Transparent materials**: a `transparent: true` material sorts per object as in Three; for big windowed
  meshes use alpha scissor as the web game does (`models.js` WINDOWED).

## Testing

- **Never run Godot on this folder itself**: several sessions work in it. Copy it to your own scratch folder
  and run there, and mirror again after each change:
  `robocopy C:\Users\Garre\Documents\bomber-game\godot <your scratch>\godot /MIR /NFL /NDL /NJH /NJS`
  (the `.godot` import cache comes along, so nothing reimports). If you add assets, run
  `Godot_v4.7.2-stable_win64_console.exe --headless --path <copy> --import` on the copy.
- Test scenes live in `tests/<area>/`; `src/core/test_kit.gd` has `shot()`, `wait()`, `time_frames()` and a
  plain `stage()` (sky, sun, camera). Run one with
  `Godot_v4.7.2-stable_win64_console.exe --path <copy> res://tests/<area>/<test>.tscn -- --out=<folder>`
  (it opens a window: rendering needs one).
- **Compare with the web game**: take the same view in both, at 1920×1080, and look at them side by side.
  For the web game, build it into your own folder and serve it on your own port
  (`npx vite build --outDir <scratch>/dist --emptyOutDir`, then `npx vite preview --open false --outDir <scratch>/dist
  --port <unused port> --strictPort` in the background); other sessions use `dist` and the common ports.
  Balance and frame-time numbers come only from the large battle (the default; never `?battle=small`).
- Frames under 100 ms always; report your area's frame time.
- Don't commit. Report the files you wrote; the coordinating session commits when the user says so.

## Areas

| Area | Ports | Session (SendMessage `to`) |
|---|---|---|
| World and graphics | world, ground, city, river, countryside, villages, urban, environment, graphics, ssao | `local_05a2ea5b-897d-4152-8397-3575224ea5ac` |
| Bombers and the mission | bomber, formation, formationdebug, oob, history, crewnames, markings, breakup, scars, streambattle, flak, mission, battle, models | `local_cedb79f4-2394-4acd-ba24-a1caf57cdbdb` |
| The B-17's inside | interior, interiordetail, waist, topturret, ballturret, stations, cabinlook, dust | `local_5aff8288-a1b7-48d9-a3f5-747a543ef563` |
| The crew and you | crew, crowd, figure, player, eject, parachutes, walksweep | `local_417df20e-1b54-4f0b-954c-9cdc40e4bc79` |
| Fighters | fighters, farfighters, fw190, p47, tags, pilot | `local_5b635d04-2985-4ea1-a4bd-fd32f6b4ca37` |
| Cockpits | cockpit, cockpit109, cockpitfw190, cockpitp47, cockpitb17, b17gauges | `local_b700c6fe-f406-48df-a669-4fa487c04475` |
| Guns, effects and sound | weapons, browning, effects, audio, radio, funk, archive, lines | `local_6b94be67-f9dc-489e-860f-3e19a427e768` |
| Menus and screen | ui, menus.css, stats, viewer | `local_c2fea32e-4a71-4abf-8cd5-e74c05de9dbd` |
| Joining it up (coordinating session) | main, src/core | the session that started you |
