# 筆 / FUDE — handover

*(working title; rename freely — 運筆 unpitsu, 墨道 bokudō, etc.)*

A local, build-free web app that renders Japanese characters as **sumi-e brush strokes**, drawn in correct stroke order, with ink synthesized in a fragment shader along the character's medians. It is a calligraphy-feel kanji/kana learning tool, not an animation export pipeline.

This document is the build brief. A working PoC exists (`sumi-brush-poc.html`) that proves the rendering core; this doc says what to keep, what to replace, and what to add.

---

## 1. The one architectural decision (do not relitigate)

Strokes are **distance fields in the fragment shader**, not tessellated ribbons. Each stroke is a centerline polyline (the *median*); every pixel measures its distance to that polyline and the brush is a width field thresholded against it. Caps, joins, and sharp corners fall out for free. The ribbon route (offset the normal, build a triangle strip) dies on miter blowups and self-intersection at the tight corners kanji are full of — that route is closed.

**Medians are data, ink is expressive.** The geometry comes from a corpus (animCJK); the look is synthesized. Keep these layers separate at every level of the code.

The PoC caps median data in a `uniform vec3[]` sized for one glyph. **That cap must go** — see §4 (multi-glyph), which moves medians into a float-texture atlas. This is the single largest structural change from the PoC.

---

## 2. Stack & constraints

- **Vanilla ES modules, no build step.** No bundler, no framework. Served by any static file server (data files are `fetch`ed, so `file://` won't work — document `python3 -m http.server` or equivalent in the README).
- **WebGL2** (core float textures, `gl_VertexID` fullscreen triangle). No WebGL1 fallback required; WebGPU optional later for offline SDF baking (§ feature 3-containment).
- **Type:** EB Garamond / Cormorant Garamond (display, italic for accents), JetBrains Mono (labels, data). Use OKLCH for color where practical.
- **Aesthetic:** dark lacquer instrument cabinet framing a lit washi surface. The stage (canvas) is warm paper; all chrome around it is near-black. Spend boldness on the paper+ink; keep controls quiet. Brush-vernacular labels in Japanese with small English glosses (起筆 / にじみ / かすれ / 墨色), since those *are* the real parameters.
- **No PII anywhere** in code, comments, sample text, or committed data. Sample strings stay generic.
- Responsive to mobile; respect `prefers-reduced-motion` (offer a static "final stroke" render with no animation).

---

## 3. Data spine (all open, all offline)

Three sources, fetched once and cached. Bundle a subset (kyōiku set is enough to start) rather than the full corpora.

| Source | Gives | Format | License |
|---|---|---|---|
| **animCJK** (`graphicsJa.txt`, `svgsJa/`, `svgsJaKana/`) | medians (centerlines) + stroke outlines + **corrected stroke order** | `graphicsJa.txt` is Makemeahanzi-format: one char per line, JSON with `strokes` (outline paths) and `medians` (point arrays) | see its `licenses/` (Makemeahanzi/Arphic lineage) — preserve attribution |
| **KANJIDIC2** (EDRDG) | per-kanji `<grade>` (1–6 = kyōiku, 8 = rest of jōyō) **and** English `<meaning>` fields | single XML | CC BY-SA 4.0 — attribution required |
| **KanjiVG** | per-stroke `kvg:type` tags (の, す, etc. → terminal/shape class) | SVG per char | CC BY-SA 3.0 — attribution required |

`graphicsJa.txt` is the clean parse target for geometry (one file, no per-char fetch). KANJIDIC2 covers **both** feature 3 (grade lists) and feature 5 (English lookup) — don't pull a second dataset for those. KanjiVG drives the typed brush profiles (feature 1, terminals).

Suggested preprocessing: a small Node script (`tools/build-data.mjs`) that emits `assets/data/medians.json` (unicode → {medians, order, strokeCount}), `assets/data/index.json` (grade → [unicode], english → [unicode], unicode → {meanings, grade, readings}), and `assets/data/stroketypes.json` (unicode → [kvg:type per stroke]). Ship the kyōiku subset first; the full jōyō set is a flag.

---

## 4. Feature list

Ordered roughly by dependency. Each has acceptance criteria.

### F1 — Calligraphy-grounded effect controls *(priority; subsumes the PoC's flat sliders)*

Replace the PoC's independent `bleed`/`kasure`/`warp` sliders with a model grounded in 用筆法 (brush method). The PoC's bleed is the known weak point — the fix is the **ink-load depletion model**, not a better halo.

Controls, each mapping to a real concept:

- **提按 (pressure, lift↔press)** — primary width modulation along the stroke. The master width-dynamics control.
- **中鋒↔側鋒 (centered↔side tip)** — brush-axis asymmetry. Centered = symmetric width and even ink about the median; side = asymmetric width using the *signed* `across` coordinate, one sharp edge. (PoC computes `across` already but renders symmetric — wire it in.)
- **蔵鋒↔露鋒 (hidden↔exposed entry tip)** — entry profile: hidden = rounded, tucked start; exposed = sharp point. Shapes `widthProfile`'s entry segment + optional reverse-hook.
- **速度 (speed)** — coupled, not independent: faster → thinner + more kasure (dry), slower → wetter + more bleed.
- **墨量 / 潤渇 (ink load, wet→dry)** — **the bleed fix.** Give each stroke an ink budget that depletes with arc length. Bleed amplitude ∝ remaining ink, concentrated at 起筆 (entry); kasure (飛白) emerges as ink runs out, toward 収筆 (exit). Bleed should be a distance-field feather with low-freq warp **plus** a separate high-freq capillary noise only at the wet frontier — not a uniform widen of the core (that's what reads wrong now).
- **終筆 terminal style (とめ / はね / はらい — stop / hook / sweep)** — exit behavior. Auto-selected per stroke from KanjiVG `kvg:type`, with a manual override for experimentation.
- **永字八法 presets (Eight Principles of Yong)** — a preset library: 側 dot, 勒 horizontal, 努 vertical, 趯 hook, 策 rising, 掠 long sweep, 啄 short sweep, 磔 pressed sweep. Each preset = a (`widthProfile`, terminal, pressure-curve) triple. Doubles as the default mapping target for KanjiVG types.

Plus retained paper controls (紙肌 grain, and a **paper absorbency / dōsa** control that scales にじみ globally).

**Acceptance:** a centered-tip slow wet stroke and a side-tip fast dry sweep look visibly, correctly different on the same glyph; bleed concentrates at stroke entry and dries toward the exit; the eight presets are selectable and distinct.

### F2 — Multi-character input: words, kana, full sentences

Free-text input renders the whole string as brush strokes, animated in reading order.

- Tokenize input → glyphs; resolve each to a median set (kanji from animCJK `svgsJa`, kana from `svgsJaKana`). Mixed kanji+kana+punctuation.
- **Layout engine:** grid (横書き, N columns, wrap) and **縦書き (tategaki)** vertical mode toggle. Even glyph cells; consistent baseline/centering.
- Missing glyph (not in corpus) → render greyed via system font as a static fallback with a small marker; never crash the row.
- Animation modes: sequential across the whole string, all-at-once, or per-glyph on hover/click.
- **Architecture:** medians for all on-screen glyphs go into a **float-texture atlas** (RGBA32F, NEAREST). Render one draw call per glyph cell with a per-cell uniform (offset, scale, atlas base + stroke count); loop `MAX_STROKES` in-shader with an early `break` past the glyph's count. This removes the PoC's single-glyph uniform-array cap.

**Acceptance:** a full sentence with mixed kanji/kana renders and animates in correct order, both horizontal and vertical; a 25+-stroke kanji renders without ink smearing into neighbors (depends on F3-containment).

### F3 — Grade-level kanji lists (kyōiku, current 2020 set)

Browse/select by school grade. Picking a grade loads its set; picking a character renders it.

Current counts (post-2020 revision; total **1,026**):

| Grade | Count |
|---|---|
| 1年 | 80 |
| 2年 | 160 |
| 3年 | 200 |
| 4年 | 202 |
| 5年 | 193 |
| 6年 | 191 |

(The older 200/185/181 split for grades 4–6 predates the 2020 addition of 20 prefecture kanji to grade 4 and the reshuffles — use the table above.) Pull grade membership from KANJIDIC2 `<grade>`. Optionally expose JLPT and the remaining jōyō (grade 8) as additional filters later.

**Acceptance:** each grade tab shows exactly its set; counts match the table; selecting a glyph routes it into the renderer.

### F4 — Stroke-order numbers (toggle)

Overlay numerals showing draw order.

- A 2D overlay (separate `<canvas>` or SVG layer) aligned to the WebGL canvas, **not** in the shader (keeps it crisp and exportable).
- Place each numeral at its median's start point, offset along the start-segment normal by ~half the brush width; scale to glyph size.
- Toggle on/off; color distinct from ink (teal reads well on washi). Honor per-glyph cell transforms in multi-glyph mode.

**Acceptance:** numbers sit at each stroke's origin, in order, for single and multi-glyph; toggle is instant; numbers appear in PNG export when enabled (§F7).

### F5 — English → kanji suggestions (no IME required)

For learners without Japanese input set up. Type English, get candidate kanji.

- Build an `{english_keyword → [unicode]}` index from KANJIDIC2 `<meaning>` fields at load (or prebake into `index.json`). "water" → 水, 河 …; rank by grade then stroke count (simpler first).
- Render candidates as clickable chips (show glyph + gloss + grade badge); clicking appends to the input string.
- Offline by default. Optional online fallback (jisho.org / JMdict) behind a flag — note CORS; offline KANJIDIC2 is the clean path and should be the default.

**Acceptance:** common English words return sensible kanji offline; clicking a chip adds the glyph and it renders.

### F6 — Size control

- Glyph **cell size** in px drives layout and brush scale together (brush width is expressed relative to cell size, so it scales without separate tuning).
- DPR-aware render target. A separate **export scale** multiplier (1×/2×/4×) feeds F7.

**Acceptance:** changing size rescales glyphs and brush proportionally with no relayout glitches; small and large both stay crisp.

### F7 — PNG export

- Composite WebGL canvas **+** the stroke-number overlay (F4) into one image, `canvas.toBlob('image/png')`, trigger download.
- Render export through an **offscreen framebuffer at the chosen export scale** (§F6) so output quality is independent of viewport/screen size.
- Background options: **washi paper** (default) or **transparent** (skip the paper fill → alpha channel) for compositing into documents/Anki.
- Gotcha: either set `preserveDrawingBuffer:true` or render-then-`toBlob` synchronously in the same frame; and draw the overlay into the export canvas explicitly (it's a separate layer on screen).

**Acceptance:** exported PNG matches what's on screen at chosen scale, including numbers when toggled; transparent-bg variant has correct alpha.

---

## 5. Suggested file structure (vanilla ESM)

```
index.html
css/style.css
js/
  main.js            bootstrap, UI wiring
  gl/renderer.js     WebGL2 setup, program, atlas, per-glyph draw
  gl/shaders.js      vertex + fragment GLSL (strings)
  brush/params.js    用筆 parameter model + 永字八法 presets
  brush/profiles.js  widthProfile / terminal logic, KanjiVG type → profile map
  data/medians.js    load + parse graphicsJa → median sets (cached)
  data/kanjidic.js   grade lists + english index
  data/kanjivg.js    stroke-type tags
  layout/engine.js   string → glyph cells; grid + tategaki
  ui/controls.js     panel, sliders, presets, grade browser, english chips
  ui/numbers.js      stroke-order overlay (2D layer)
  export/png.js      offscreen render + download
assets/data/         medians.json, index.json, stroketypes.json (kyōiku subset first)
tools/build-data.mjs preprocessor (animCJK + KANJIDIC2 + KanjiVG → assets/data)
```

---

## 6. Carry-forward from the PoC (validated core)

Port these; they work. Do **not** re-derive them.

**Median resample** (Catmull-Rom → equal arc-length, carries normalized `t`): coarse animCJK medians (3–4 pts) are smoothed and resampled to N≈24 points per stroke, each as `(x, y, t)`. Equal arc spacing is what makes width/texture uniform along the stroke.

**SDF fragment core** — per pixel, per stroke: closest-point on the median polyline yields `(dist, t, signed_across)`; `widthProfile(t)` sets half-width; threshold `smoothstep(w, w-edge, dist+warp)` gives coverage; reveal by `smoothstep(prog, prog-ε, t)` (one scalar per stroke). FBM value-noise drives edge warp, kasure streaks (sampled in a `t`×`across` frame so they run *along* the stroke), and density mottling. Key functions to lift verbatim:

```glsl
// hash → value noise → 5-octave fbm  (lift as-is)
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);float a=hash(i),b=hash(i+vec2(1,0)),
  c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<5;i++){s+=a*vnoise(p);p=m*p;a*=.5;}return s;}

// closest point on a stroke's polyline → (dmin, tmin, signed across)
// loop segments; project pixel onto each; track min distance,
// interp t at the closest point, and signed perpendicular via 2D cross.
```

The PoC's `closest()`, `widthProfile()`, and the paper/vignette composite are the starting point for `gl/shaders.js`. The reveal, kasure-frame, and density-mottle logic transfer directly.

---

## 7. Known issues & explicit guidance

- **にじみ (bleed) is the weak spot.** The PoC's wide soft halo reads as a uniform blur, not wet ink. Do not just tune it — replace with the ink-load depletion model (F1, 墨量): bleed amplitude tied to remaining ink and concentrated at entry, with a high-freq capillary noise only at the wet frontier. This is the priority visual fix.
- **One-glyph cap** in the PoC (`uniform vec3[]`) — must become the texture atlas (F2) before sentences work. Don't try to grow the uniform array; mobile `MAX_FRAGMENT_UNIFORM_VECTORS` will bite.
- **Generic width profile** — the PoC uses one profile for all strokes; the spear (`はらい`/`はね`) and a stopped vertical (`とめ`) should differ. Drive `widthProfile` + terminal from KanjiVG type (F1).
- **Containment for dense kanji** — the PoC keeps ink in shape only via the width field, fine for 中, unsafe for 25-stroke glyphs under heavy bleed. Bake each glyph's *outline* to an SDF (offline; jump-flood is the WebGPU path) and clamp ink to it. This is what lets bleed/kasure be cranked without losing legibility. Defer until F2 lands, but design the atlas so an outline-SDF channel can be added.
- **Fonts/data need a server** (fetch) — say so in the README; `file://` will fail silently-ish.

---

## 8. Definition of done (v1)

Type a grade-1 kanji, a kana word, or an English term; get correct stroke-order sumi-e animation with calligraphy-grounded controls and 永字八法 presets; browse by grade; toggle stroke numbers; resize; export a PNG (paper or transparent) that matches the screen. Build-free, offline, attribution preserved for animCJK / KANJIDIC2 / KanjiVG.
