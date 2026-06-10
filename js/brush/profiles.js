// profiles.js — terminal/profile logic + KanjiVG-type → preset mapping.
// For V1 the width/terminal MATH lives in the shader (driven by uniforms). This
// module owns the *mapping* layer: a geometric terminal heuristic (used until the
// KanjiVG kvg:type atlas channel lands — HANDOVER §7) and the type→preset table.

import { PRESETS } from './params.js';

// KanjiVG kvg:type prefix → 永字八法 preset id (deferred wiring; table ready for F1).
export const KVG_MAP = {
  '㇔': 'soku', '㇐': 'roku', '㇑': 'do', '㇂': 'teki',
  '㇏': 'zhe', '㇒': 'ryaku', '㇓': 'ryaku', '㇖': 'roku',
};

export const presetById = (id) => PRESETS.find((p) => p.id === id) || null;

// Geometric terminal heuristic from a resampled stroke's samples → {0:tome,1:hane,2:harai}.
// Long, mostly-straight, diagonal strokes read as はらい sweeps; short ones as とめ.
export function terminalFor(stroke) {
  if (!stroke || stroke.samples.length < 2) return 0;
  const a = stroke.samples[0], b = stroke.samples[stroke.samples.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const diagonal = Math.abs(dx) > 0.12 && Math.abs(dy) > 0.12;
  if (len > 0.45 && diagonal) return 2;     // long diagonal → はらい
  return 0;                                  // default → とめ
}
