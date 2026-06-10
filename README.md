# 筆 / FUDE

A local, build-free web app that renders Japanese characters as **sumi-e brush
strokes**, drawn in correct stroke order, with ink synthesized in a WebGL2 fragment
shader along each character's medians. A calligraphy-feel kanji/kana learning tool —
not an animation-export pipeline.

> Strokes are **distance fields in the fragment shader**, not tessellated ribbons.
> Medians are *data* (from the animCJK corpus); ink is *expressive* (synthesized).
> Those two layers stay separate at every level of the code.

## Run it

Vanilla ES modules, **no build step**. Data files are `fetch`ed, so `file://` will
not work — serve over HTTP from the project root:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (`npx serve`, nginx, etc.). WebGL2 is required (no WebGL1
fallback).

### Shareable state

The initial view can be set from the URL:

```
?q=日本語     text to render (kanji / kana / sentence)
?n=1          stroke-order numbers on
?dir=tate     縦書き vertical writing
?anim=all     animate all strokes at once (default: sequential)
```

e.g. `http://localhost:8000/?q=水&n=1`

## What works (V1)

- **F1** 用筆 controls — 提按 pressure, 中鋒↔側鋒 tip, 蔵鋒↔露鋒 entry, 墨量 ink-load,
  にじみ bleed, 掠れ kasure, plus 永字八法 presets. **終筆 terminals are per-stroke**,
  auto-set from KanjiVG (止め/はね/左払い/右払い/点 — a property of each stroke's
  geometry, not its order); **click any stroke on the paper to override its ending**.
  Bleed uses an **ink-depletion model** (wet at 起筆, drying toward 収筆), not a flat halo.
- **F2** Multi-character input (kanji + kana + sentences), grid + 縦書き, via a
  float-texture **median atlas** (one draw call per glyph cell).
- **F3** Grade-level kanji lists (kyōiku 1–6) in the browser rail.
- **F4** Stroke-order numbers, toggleable, on a crisp 2D overlay.
- **F5** English → kanji search (offline), click a chip to append.
- **F6** Glyph size control; DPR-aware render.
- **F7** PNG export (washi or transparent), offscreen at export scale.

See `HANDOVER-fude.md` for the full brief and acceptance criteria, and
`.deban/` for the decision log (dead ends + lessons).

## Rebuilding the data

The bundled `assets/data/*.json` is prebaked. To regenerate (e.g. to widen the
glyph set), fetch the source corpora into `tools/.cache/` and run the preprocessor:

```bash
mkdir -p tools/.cache
curl -o tools/.cache/graphicsJa.txt      https://raw.githubusercontent.com/parsimonhi/animCJK/master/graphicsJa.txt
curl -o tools/.cache/graphicsJaKana.txt  https://raw.githubusercontent.com/parsimonhi/animCJK/master/graphicsJaKana.txt
curl -o tools/.cache/kanji.json          https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json
curl -L -o tools/.cache/kanjivg.xml.gz   https://github.com/KanjiVG/kanjivg/releases/download/r20160426/kanjivg-20160426.xml.gz
gunzip -f tools/.cache/kanjivg.xml.gz     # → tools/.cache/kanjivg.xml (per-stroke terminal types)
node tools/build-data.mjs                 # GRADES=1,2 node tools/build-data.mjs  to narrow
```

## Attribution & licenses

This project bundles data derived from open corpora. Attribution is required:

- **Medians & stroke order** — [animCJK](https://github.com/parsimonhi/animCJK)
  (parsimonhi), Makemeahanzi / Arphic lineage. Preserve the upstream `licenses/`.
- **Grades, meanings, readings** — [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project)
  © EDRDG, **CC BY-SA 4.0**, via [kanji-data](https://github.com/davidluzgouveia/kanji-data).
- **Per-stroke terminal types + kana medians** — [KanjiVG](https://kanjivg.tagaini.net/),
  CC BY-SA 3.0. `kvg:type` per stroke → terminal class (止め/はね/左払い/右払い/点) for
  kanji 終筆; and the **kana medians** are sampled from KanjiVG `<path>` data, because
  animCJK's kana medians are unreliable on loop strokes (out-of-range points / wrong
  stroke counts on あ お な は ま … — 21 glyphs).
- **Type** — EB Garamond, JetBrains Mono (Google Fonts, OFL).

No PII is present in code, comments, sample text, or committed data.

## Versioning / cache-busting

A layered cache-busting toolkit (`scripts/bust.sh`) stamps one token into the
asset URLs, the `<meta name="cb">` tag, and the favicon. The same token drives the
**version badge top-left** (three shape tiles + the 8-char build token next to the
title) so a human can confirm at a glance which build is live. Bump it with:

```bash
./scripts/bust.sh                                 # one-shot
bash ~/.claude-kainode/skills/cache-busting/scripts/watch.sh   # auto-bump on save (dev)
```

Runtime `fetch()` calls are fingerprinted via `js/util/version.js` (`withV`), keeping
the data layer on the same cache key as the code.
