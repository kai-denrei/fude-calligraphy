// main.js — bootstrap + rAF loop. Imports every module and pre-wires all mount
// points, so feature work happens inside the modules behind frozen signatures.

import { createRenderer } from './gl/renderer.js';
import { loadMedians, resampleGlyph } from './data/medians.js';
import { loadIndex } from './data/kanjidic.js';
import { defaultParams } from './brush/params.js';
import { mountControls } from './ui/controls.js';
import { mountBrowser } from './ui/browser.js';
import { mountNumbers, resizeNumbers, drawNumbers } from './ui/numbers.js';
import { exportPNG } from './export/png.js';
import { readMetadata } from './export/metadata.js';
import { loadStrokeTypes, baseTerminals, TERMINAL_NAMES, hasKvg } from './data/terminals.js';
import { VERSION, BUILD_TOKEN } from './util/version.js';

const $ = (id) => document.getElementById(id);

const state = {
  text: '中',
  params: defaultParams(),
  mode: 'grid',          // 'grid' | 'tate'
  anim: 'seq',           // 'seq' | 'all'
  cellSize: 0,           // 0 = auto-fit
  showNumbers: false,
  showSkel: false,
  paperOn: true,
  cells: [],
  pristine: true,        // still showing the untouched default 中 → first pick replaces it
  termOverrides: {},     // `${tokenIndex}:${strokeIndex}` → terminal class (manual override)
};

// per-stroke terminals = KanjiVG/geometric base, with manual click-overrides applied
function applyTermOverrides(c) {
  const t = c.baseTerminals.slice();
  for (let i = 0; i < c.strokeCount; i++) {
    const k = state.termOverrides[`${c.index}:${i}`];
    if (k !== undefined) t[i] = k;
  }
  return t;
}

let renderer, t0 = 0, TOTAL = 1, reduceMotion = false, dirty = true, settled = false;
const markDirty = () => { dirty = true; };   // request a single re-render (idle when settled)

// ---- header version badge: 3 cache-bust shapes + token, top-left by the title ----
function renderBadge() {
  const wrap = $('cbShapes'); if (!wrap) return;
  const hex = (BUILD_TOKEN.match(/[0-9a-f]{2}/gi) || ['00', '00', '00']).slice(0, 3);
  wrap.innerHTML = hex.map((b) => {
    const cell = String(parseInt(b, 16) % 64).padStart(2, '0');
    return `<img src="cb-shapes/${cell}.svg" alt="" width="13" height="13">`;
  }).join('');
  const tok = $('cbToken'); if (tok) tok.textContent = BUILD_TOKEN;
  const ver = $('cbVersion'); if (ver) ver.textContent = 'v' + VERSION;
}

// ---- 速度 coupling + 礬水 dōsa: derive the params actually sent to the shader ----
function deriveRenderParams(p) {
  const sp = p.speed - 1;
  return {
    ...p,
    width: p.width * (1 - 0.12 * sp),
    kasure: Math.min(1, p.kasure + 0.14 * Math.max(0, sp)),
    bleed: p.bleed * (0.45 + p.absorb * 1.1) * (1 - 0.2 * Math.max(0, sp)),
  };
}

// ---- build per-cell stroke schedule (length-weighted + inter-stroke lift) ----
function buildSchedule() {
  const GAP = 0.45, LIFT = 0.1, HOLD = 0.4;
  let cursor = 0; let maxEnd = 0;
  for (const c of state.cells) {
    if (!c.glyph) continue;
    const lens = c.glyph.strokes.map((s) => s.length);
    const sum = lens.reduce((a, b) => a + b, 0) || 1;
    const durs = lens.map((l) => 0.25 + 0.75 * (l / sum));
    const starts = [];
    let acc = state.anim === 'all' ? 0 : cursor;
    const glyphStart = acc;
    durs.forEach((d) => { starts.push(acc); acc += d + LIFT; });
    c.starts = starts; c.durs = durs;
    c.prog = new Float32Array(renderer.MAX_STROKES);
    maxEnd = Math.max(maxEnd, acc);
    if (state.anim === 'seq') cursor = acc + GAP;
  }
  TOTAL = maxEnd + HOLD;
  t0 = performance.now();
  settled = false; dirty = true;   // re-animate from the start, hold on the final frame
}

// ---- resolve the input string into renderable cells ----
function rebuild() {
  const { W, H } = renderer.size;
  const tokens = [...state.text].filter((c) => !/\s/.test(c));
  const n = Math.max(1, tokens.length);
  // auto-fit cell to BOTH grid dimensions (F6). The block is `across` cells wide and
  // `down` cells tall — size to whichever is tighter so nothing spills off-canvas.
  const GAP = 0.08;                          // must match layout/engine.js
  const k = Math.ceil(Math.sqrt(n));
  const cols = state.mode === 'tate' ? n : k;   // engine: perCol (tate) / perRow (grid)
  const across = state.mode === 'tate' ? Math.ceil(n / cols) : k;
  const down = state.mode === 'tate' ? cols : Math.ceil(n / k);
  const fit = Math.min(W / (across * (1 + GAP)), H / (down * (1 + GAP)));
  const cell = state.cellSize > 0 ? state.cellSize : Math.min(fit * 0.96, Math.min(W, H) * 0.86);
  import('./layout/engine.js').then(({ layout }) => {
    const cells = layout(state.text, { W, H, cell, mode: state.mode, cols, gap: GAP });
    for (const c of cells) { c.glyph = resampleGlyph(c.char); c.fallback = !c.glyph; }
    state.cells = cells;
    renderer.setGlyphs(cells);
    for (const c of cells) if (c.glyph) { c.baseTerminals = baseTerminals(c.char, c.glyph); c.terminals = applyTermOverrides(c); }
    buildSchedule();
    syncFallbacks();
  });
}

// missing glyphs → greyed system-font fallback markers in the overlay layer (F2)
function syncFallbacks() {
  const layer = $('fallbacks'); if (!layer) return;
  layer.innerHTML = '';
  for (const c of state.cells) {
    if (!c.fallback) continue;
    const d = document.createElement('div');
    d.className = 'fallback-glyph';
    d.textContent = c.char;
    d.style.left = c.x + 'px'; d.style.top = c.y + 'px';
    d.style.width = c.size + 'px'; d.style.height = c.size + 'px';
    d.style.fontSize = c.size * 0.7 + 'px';
    layer.appendChild(d);
  }
}

function setText(t) { state.text = t || '中'; state.termOverrides = {}; const inp = $('text'); if (inp && inp.value !== state.text) inp.value = state.text; rebuild(); }

// --- per-stroke terminal override: click a stroke on the paper → pick its 終筆 (F1) ---
function distToPolyline(px, py, samples) {
  let m = 1e9;
  for (let i = 0; i < samples.length - 1; i++) {
    const ax = samples[i].x, ay = samples[i].y, dx = samples[i + 1].x - ax, dy = samples[i + 1].y - ay;
    const L = dx * dx + dy * dy || 1e-9;
    const h = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
    m = Math.min(m, Math.hypot(px - (ax + dx * h), py - (ay + dy * h)));
  }
  return m;
}

function onStrokeClick(e) {
  const cv = $('gl'), r = cv.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width * renderer.size.W;
  const py = (e.clientY - r.top) / r.height * renderer.size.H;
  let best = null, bestD = 1e9, bestStroke = -1;
  for (const c of state.cells) {
    if (!c.glyph || px < c.x || px > c.x + c.size || py < c.y || py > c.y + c.size) continue;
    const ux = (px - c.x) / c.size, uy = (py - c.y) / c.size;
    c.glyph.strokes.forEach((st, i) => {
      const d = distToPolyline(ux, uy, st.samples);
      if (d < bestD) { bestD = d; best = c; bestStroke = i; }
    });
  }
  if (best && bestD < 0.09) openTermPopover(e.clientX, e.clientY, best, bestStroke);
  else closeTermPopover();
}

let popoverEl = null;
function closeTermPopover() { if (popoverEl) { popoverEl.remove(); popoverEl = null; } }
function openTermPopover(x, y, cell, strokeIdx) {
  closeTermPopover();
  const key = `${cell.index}:${strokeIdx}`;
  const cur = state.termOverrides[key] ?? cell.baseTerminals[strokeIdx];
  const el = document.createElement('div');
  el.className = 'term-popover';
  el.style.left = Math.min(x + 6, window.innerWidth - 160) + 'px';
  el.style.top = Math.min(y + 6, window.innerHeight - 170) + 'px';
  el.innerHTML = `<div class="tp-head">画 ${strokeIdx + 1} · 終筆</div>`;
  const grid = document.createElement('div'); grid.className = 'tp-grid';
  TERMINAL_NAMES.forEach((name, k) => {
    const b = document.createElement('button');
    b.textContent = name; b.className = 'tp-btn' + (k === cur ? ' on' : '');
    b.onclick = () => { state.termOverrides[key] = k; cell.terminals = applyTermOverrides(cell); markDirty(); closeTermPopover(); };
    grid.appendChild(b);
  });
  el.appendChild(grid);
  const auto = document.createElement('button');
  auto.className = 'tp-auto' + (state.termOverrides[key] === undefined ? ' on' : '');
  auto.textContent = hasKvg(cell.char) ? '↺ auto · KanjiVG' : '↺ auto · geom';
  auto.onclick = () => { delete state.termOverrides[key]; cell.terminals = applyTermOverrides(cell); markDirty(); closeTermPopover(); };
  el.appendChild(auto);
  document.body.appendChild(el); popoverEl = el;
}
document.addEventListener('mousedown', (e) => { if (popoverEl && !popoverEl.contains(e.target) && e.target !== $('gl')) closeTermPopover(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTermPopover(); });

function resetTerminals() {
  state.termOverrides = {};
  for (const c of state.cells) if (c.glyph) c.terminals = applyTermOverrides(c);
  markDirty();
}

// restore a settings snapshot read from a fude PNG (see export/metadata.js)
function applySave(s) {
  if (!s) return;
  if (s.params) Object.assign(state.params, s.params);
  if (s.mode) { state.mode = s.mode; $('btnMode').textContent = state.mode === 'tate' ? '縦書き' : '横書き'; }
  if (s.anim) { state.anim = s.anim; $('btnAnim').textContent = state.anim === 'seq' ? '順番' : '同時'; }
  state.termOverrides = s.termOverrides || {};
  if (s.text) { state.text = s.text; state.pristine = false; const inp = $('text'); if (inp) inp.value = s.text; }
  mountControls($('controls'), state.params, markDirty, { resetTerminals });
  rebuild();   // reads state.text + state.termOverrides
}

// ---- render loop: draw once and hold; re-render only while animating or after a
//      change (markDirty). No constant looping — ↺ redraws, sliders update live. ----
function frame(now) {
  let e = (now - t0) / 1000 * state.params.speed;
  if (reduceMotion) e = TOTAL;
  // render every frame until the final frame is drawn (settled), then idle. A param
  // change (markDirty) draws one more frame. This holds the complete glyph regardless
  // of frame-timing jumps — no constant looping.
  if (!settled || dirty) {
    const MAXS = renderer.MAX_STROKES;
    for (const c of state.cells) {
      if (!c.glyph) continue;
      for (let s = 0; s < MAXS; s++) {
        c.prog[s] = s < c.strokeCount ? Math.max(0, Math.min(1, (e - c.starts[s]) / c.durs[s])) : 0;
      }
    }
    const rp = deriveRenderParams(state.params);
    renderer.draw({ cells: state.cells, params: rp, paperOn: state.paperOn, showSkel: state.showSkel, time: (now - t0) / 1000 });
    drawNumbers(state.cells, state.showNumbers, state.params);
    if (e >= TOTAL && state.cells.some((c) => c.glyph)) settled = true;  // final frame shown
    dirty = false;
  }
  requestAnimationFrame(frame);
}

// ---- bootstrap ----
async function boot() {
  const canvas = $('gl');
  try { renderer = createRenderer(canvas); }
  catch (err) {
    $('stage').innerHTML = `<div class="glfail">WebGL2 unavailable.<br><small>${err.message}</small></div>`;
    return;
  }
  const overlay = $('overlay');
  mountNumbers(overlay);

  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function onResize() {
    renderer.resize();
    const { W, H } = renderer.size;
    overlay.__logicalW = W; overlay.__logicalH = H;
    resizeNumbers(W, H);
    rebuild();
  }

  // Load data BEFORE wiring resize/rebuild — otherwise the ResizeObserver's initial
  // callback rebuilds with DB===null and every glyph resolves to a fallback.
  await Promise.all([loadMedians(), loadIndex(), loadStrokeTypes()]);

  renderBadge();
  mountControls($('controls'), state.params, markDirty, { resetTerminals });
  $('gl').addEventListener('click', onStrokeClick);   // live preview on slider/preset change
  // first pick replaces the default 中; later picks append (build words/sentences)
  mountBrowser($('browser'), { onPick: (s) => { setText(state.pristine ? s : state.text + s); state.pristine = false; } });

  // toolbar wiring
  $('text').value = state.text;
  $('text').addEventListener('input', (e) => { state.pristine = false; setText(e.target.value); });
  $('btnMode').addEventListener('click', () => { state.mode = state.mode === 'grid' ? 'tate' : 'grid'; $('btnMode').textContent = state.mode === 'tate' ? '縦書き' : '横書き'; rebuild(); });
  $('btnAnim').addEventListener('click', () => { state.anim = state.anim === 'seq' ? 'all' : 'seq'; $('btnAnim').textContent = state.anim === 'seq' ? '順番' : '同時'; buildSchedule(); });
  $('btnReplay').addEventListener('click', () => { t0 = performance.now(); settled = false; dirty = true; });
  $('size').addEventListener('input', (e) => { state.cellSize = +e.target.value; rebuild(); });
  $('tglNumbers').addEventListener('click', () => { state.showNumbers = !state.showNumbers; $('tglNumbers').classList.toggle('on', state.showNumbers); markDirty(); });
  $('tglSkel').addEventListener('click', () => { state.showSkel = !state.showSkel; $('tglSkel').classList.toggle('on', state.showSkel); markDirty(); });
  // a fude PNG carries the full settings (params + text + per-stroke overrides) in a
  // tEXt chunk; importing one restores them.
  const buildSave = () => ({ v: VERSION, text: state.text, mode: state.mode, anim: state.anim, params: { ...state.params }, termOverrides: { ...state.termOverrides } });
  $('btnExport').addEventListener('click', () => exportPNG(renderer, { cells: state.cells, params: deriveRenderParams(state.params), showSkel: state.showSkel, paperOn: true }, { scale: 2, withNumbers: state.showNumbers, params: state.params, save: buildSave() }));
  $('btnExportT').addEventListener('click', () => exportPNG(renderer, { cells: state.cells, params: deriveRenderParams(state.params), showSkel: false, paperOn: false }, { scale: 2, transparent: true, withNumbers: state.showNumbers, params: state.params, save: buildSave() }));
  $('btnImport').addEventListener('click', () => $('fileImport').click());
  $('fileImport').addEventListener('change', async (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const json = readMetadata(await f.arrayBuffer());
    if (!json) { alert('No fude settings found in that PNG.'); return; }
    try { applySave(JSON.parse(json)); } catch { alert('Could not read fude settings from that PNG.'); }
  });

  // shareable initial state via URL: ?q=水あ&n=1&dir=tate&anim=all
  const q = new URLSearchParams(location.search);
  if (q.get('q')) { state.text = q.get('q'); $('text').value = state.text; state.pristine = false; }
  if (q.get('n')) { state.showNumbers = true; $('tglNumbers').classList.add('on'); }
  if (q.get('dir') === 'tate') { state.mode = 'tate'; $('btnMode').textContent = '縦書き'; }
  if (q.get('anim') === 'all') { state.anim = 'all'; $('btnAnim').textContent = '同時'; }

  // mobile panel switcher (学習 browse / 筆 brush) — canvas stays pinned above
  document.querySelectorAll('.mobile-tabs button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelector('main').className = b.dataset.panel === 'brush' ? 'show-brush' : 'show-browse';
      document.querySelectorAll('.mobile-tabs button').forEach((x) => x.classList.toggle('on', x === b));
      requestAnimationFrame(() => { renderer.resize(); markDirty(); });   // canvas size may change
    });
  });

  new ResizeObserver(onResize).observe(canvas.parentElement);
  onResize();
  requestAnimationFrame(frame);
}

boot();

// --- PWA: offline service worker + non-blocking update toast ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw && sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            const t = document.getElementById('pwaToast');
            if (!t) return;
            t.innerHTML = '<span class="tk">↻</span> new version — tap to update';
            t.hidden = false;
            t.onclick = () => { t.hidden = true; reg.waiting && reg.waiting.postMessage('SKIP_WAITING'); };
          }
        });
      });
    } catch { /* SW optional */ }
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}
