// terminals.js — per-stroke 終筆 (terminal) class for each glyph.
//   0 止め tome · 1 はね hane · 2 左払い harai-left · 3 右払い harai-right · 4 点 dot
// Default source is KanjiVG kvg:type (assets/data/stroketypes.json, baked by
// build-data.mjs). Kana and the rare stroke-count-misaligned kanji have no kvg:type,
// so they fall back to a geometric heuristic. A stroke's terminal is a property of its
// geometry + structural role, never its position in stroke order (HANDOVER §F1).

import { MAX_STROKES } from '../gl/shaders.js';
import { withV } from '../util/version.js';

export const TERMINAL_NAMES = ['止め', 'はね', '左払い', '右払い', '点'];
let DB = null;     // {char: [class per stroke]}

export async function loadStrokeTypes() {
  if (DB) return DB;
  const res = await fetch(withV('assets/data/stroketypes.json'));
  DB = res.ok ? await res.json() : {};
  return DB;
}

// geometric fallback for glyphs without kvg:type (kana): long diagonal down → harai
// (right if it sweeps rightward, else left); everything else stops (tome).
function geomClass(stroke) {
  const s = stroke.samples;
  if (!s || s.length < 2) return 0;
  const a = s[0], b = s[s.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  if (len > 0.4 && Math.abs(dx) > 0.12 && dy > 0.12) return dx > 0 ? 3 : 2;
  return 0;
}

// base per-stroke classes for a glyph → Float32Array(MAX_STROKES)
export function baseTerminals(char, glyph) {
  const arr = new Float32Array(MAX_STROKES);
  const kvg = DB && DB[char];
  for (let i = 0; i < glyph.strokeCount && i < MAX_STROKES; i++) {
    arr[i] = kvg ? (kvg[i] ?? 0) : geomClass(glyph.strokes[i]);
  }
  return arr;
}

export const hasKvg = (char) => !!(DB && DB[char]);
