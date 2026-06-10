// medians.js — load animCJK medians and resample them.
//
// The Catmull-Rom → equal-arc-length resample (carrying normalized t per sample) is
// ported verbatim from the validated PoC: coarse animCJK medians (2–4 pts) are
// smoothed and resampled to NS points each as (x, y, t). Equal arc spacing is what
// makes width and texture uniform along the stroke. Do not re-derive (HANDOVER §6).

import { SAMPLES_PER_STROKE } from '../gl/shaders.js';
import { withV } from '../util/version.js';

const NS = SAMPLES_PER_STROKE;
const SC = 0.84;        // fit margin: glyph occupies the centre 84% of the cell
const VIEW = 1024;      // animCJK viewBox

let DB = null;          // {char: {m:[[[x,y],...]...], n}}
const cache = new Map();

export async function loadMedians() {
  if (DB) return DB;
  const res = await fetch(withV('assets/data/medians.json'));
  if (!res.ok) throw new Error(`medians.json ${res.status}`);
  DB = await res.json();
  return DB;
}

export function hasGlyph(ch) { return !!(DB && DB[ch]); }

const cr = (p0, p1, p2, p3, t) => {
  const t2 = t * t, t3 = t2 * t;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
};
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function resampleStroke(raw) {
  const pts = raw.map(([x, y]) => [(x / VIEW - 0.5) * SC + 0.5, (y / VIEW - 0.5) * SC + 0.5]);
  if (pts.length === 1) pts.push(pts[0]);
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  const dense = [];
  const STEPS = 48;
  for (let i = 0; i < pts.length - 1; i++)
    for (let j = 0; j < STEPS; j++) dense.push(cr(P[i], P[i + 1], P[i + 2], P[i + 3], j / STEPS));
  dense.push(pts[pts.length - 1]);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dist(dense[i - 1], dense[i]));
  const total = cum[cum.length - 1];
  const out = [];
  for (let k = 0; k < NS; k++) {
    const target = (k / (NS - 1)) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < target) i++;
    const seg = Math.max(cum[i] - cum[i - 1], 1e-9);
    const f = (target - cum[i - 1]) / seg;
    out.push({
      x: dense[i - 1][0] + (dense[i][0] - dense[i - 1][0]) * f,
      y: dense[i - 1][1] + (dense[i][1] - dense[i - 1][1]) * f,
      t: total < 1e-9 ? 0 : target / total,
    });
  }
  return { samples: out, length: total };
}

// resampleGlyph(char) → { strokes:[{samples:[{x,y,t}], length}], strokeCount } | null
export function resampleGlyph(ch) {
  if (!DB) return null;                 // data not loaded yet — never cache this (would poison)
  if (cache.has(ch)) return cache.get(ch);
  const g = DB[ch];
  if (!g) { cache.set(ch, null); return null; }
  const strokes = g.m.map(resampleStroke);
  const out = { strokes, strokeCount: strokes.length };
  cache.set(ch, out);
  return out;
}
