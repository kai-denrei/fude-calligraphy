// params.js — the 用筆 (brush-method) parameter model + 永字八法 presets.
// Single source of truth read by BOTH the UI (js/ui/controls.js) and the shader
// (via renderer.setBrush). Adding a control = add a key here + a uniform that already
// exists in shaders.js. (HANDOVER §F1.)

export function defaultParams() {
  return {
    // 運筆 — the stroke
    speed: 1.0,        // 速度 — coupled in main.js: faster → thinner + drier
    width: 0.03,       // 筆幅 — base half-width (glyph-local)
    // 用筆 — brush method
    pressure: 0.13,    // 提按 lift↔press — width-dynamics depth
    sideTip: 0.51,     // 中鋒↔側鋒 — 0 centered (symmetric) → 1 side (asymmetric)
    entryTip: 0.10,    // 蔵鋒↔露鋒 — 0 hidden/round → 1 exposed/sharp
    terminal: 0,       // 終筆 — per-stroke now (uTermClass); kept for preset compatibility
    // 墨色 — ink & paper
    inkLoad: 0.0,      // 墨量/潤渇 — wet↔dry budget (0 = dry)
    bleed: 0.0,        // にじみ amplitude
    kasure: 0.35,      // かすれ dry-brush
    warp: 0.012,       // edge warp
    dark: 0.61,        // 濃淡 ink darkness
    grain: 0.6,        // 紙肌 paper grain
    absorb: 0.5,       // 礬水 dōsa — global にじみ scale (applied in main.js)
    // color
    ink: [0.035, 0.03, 0.025],
    paper: [0.913, 0.886, 0.812],
  };
}

// 永字八法 — Eight Principles of Yong. Each preset = a (width/pressure, entry,
// terminal, ink) character. Global for V1; the per-stroke KanjiVG-type mapping is
// deferred (HANDOVER §7). Acceptance: the eight are selectable and distinct.
export const PRESETS = [
  { id: 'soku', ja: '側', en: 'dot',          p: { pressure: 0.85, entryTip: 0.9, terminal: 0, sideTip: 0.3, inkLoad: 0.85, width: 0.062 } },
  { id: 'roku', ja: '勒', en: 'horizontal',   p: { pressure: 0.35, entryTip: 0.25, terminal: 0, sideTip: 0.1, inkLoad: 0.6, width: 0.048 } },
  { id: 'do',   ja: '努', en: 'vertical',     p: { pressure: 0.55, entryTip: 0.3, terminal: 0, sideTip: 0.0, inkLoad: 0.7, width: 0.052 } },
  { id: 'teki', ja: '趯', en: 'hook',         p: { pressure: 0.6, entryTip: 0.4, terminal: 1, sideTip: 0.2, inkLoad: 0.7, width: 0.05 } },
  { id: 'saku', ja: '策', en: 'rising',       p: { pressure: 0.4, entryTip: 0.55, terminal: 2, sideTip: 0.45, inkLoad: 0.5, width: 0.044 } },
  { id: 'ryaku', ja: '掠', en: 'long sweep',  p: { pressure: 0.5, entryTip: 0.7, terminal: 2, sideTip: 0.55, inkLoad: 0.45, width: 0.05 } },
  { id: 'taku', ja: '啄', en: 'short sweep',  p: { pressure: 0.5, entryTip: 0.8, terminal: 2, sideTip: 0.5, inkLoad: 0.55, width: 0.046 } },
  { id: 'zhe',  ja: '磔', en: 'pressed sweep', p: { pressure: 0.9, entryTip: 0.5, terminal: 2, sideTip: 0.6, inkLoad: 0.8, width: 0.058 } },
];

export function applyPreset(params, preset) {
  return Object.assign(params, preset.p);
}
