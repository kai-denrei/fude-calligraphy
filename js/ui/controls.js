// controls.js — the 用筆 control panel. Brush-vernacular JA labels + EN gloss.
// mountControls(root, params, onChange): builds sliders/buttons bound to the param
// object; calls onChange() after any change. (HANDOVER §F1 controls + §F6 size.)

import { PRESETS, applyPreset } from '../brush/params.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

function slider(params, key, { ja, en, min, max, step, dp = 2 }, onChange) {
  const ctl = el('div', 'ctl');
  ctl.innerHTML = `<label><span><span class="ja">${ja}</span> <span class="en">${en}</span></span><span class="val"></span></label>`;
  const input = el('input'); input.type = 'range'; input.min = min; input.max = max; input.step = step; input.value = params[key];
  const val = ctl.querySelector('.val');
  const sync = () => { val.textContent = (+params[key]).toFixed(dp); };
  input.addEventListener('input', () => { params[key] = parseFloat(input.value); sync(); onChange(); });
  ctl.appendChild(input); sync();
  return ctl;
}

function group(title) { const g = el('div', 'group'); g.appendChild(el('div', 'gh', title)); return g; }

let advOpen = false;   // persists the +/− state across re-mounts (e.g. on preset click)

export function mountControls(root, params, onChange, handlers = {}) {
  root.innerHTML = '';

  // 永字八法 presets — the quick way to set a brush feel (always visible)
  const g4 = group('永字八法 · presets');
  const pr = el('div', 'presets');
  PRESETS.forEach((p) => {
    const b = el('button', 'preset', `<span class="pja">${p.ja}</span><span class="pen">${p.en}</span>`);
    b.title = `${p.ja} · ${p.en}`;
    b.addEventListener('click', () => { applyPreset(params, p); mountControls(root, params, onChange, handlers); onChange(); });
    pr.appendChild(b);
  });
  g4.appendChild(pr);
  root.appendChild(g4);

  // 終筆 per-stroke hint (always visible — it's an instruction, not a slider)
  const term = el('div', 'ctl');
  term.innerHTML = `<label><span><span class="ja">終筆</span> <span class="en">terminal · per stroke</span></span></label>`;
  term.appendChild(el('p', 'hint', 'click a stroke on the paper to set 止め / はね / 左払 / 右払'));
  const reset = el('button', 'wfull', '↺ all terminals → auto (KanjiVG)');
  reset.addEventListener('click', () => handlers.resetTerminals && handlers.resetTerminals());
  term.appendChild(reset);
  root.appendChild(term);

  // the brush/ink variables — collapsed behind a + (advanced)
  const adv = el('div', advOpen ? 'advanced' : 'advanced collapsed');
  const head = el('button', 'adv-head', `<span>用筆・墨色 · adjust variables</span><span class="adv-ic">${advOpen ? '−' : '+'}</span>`);
  const body = el('div', 'adv-body');
  head.addEventListener('click', () => {
    advOpen = !advOpen;
    adv.classList.toggle('collapsed', !advOpen);
    head.querySelector('.adv-ic').textContent = advOpen ? '−' : '+';
  });
  adv.appendChild(head); adv.appendChild(body);

  const g1 = group('運筆 · the stroke');
  g1.appendChild(slider(params, 'speed', { ja: '速度', en: 'speed', min: 0.3, max: 2.5, step: 0.01 }, onChange));
  g1.appendChild(slider(params, 'width', { ja: '筆幅', en: 'brush width', min: 0.02, max: 0.08, step: 0.0005, dp: 3 }, onChange));
  body.appendChild(g1);

  const g2 = group('用筆 · brush method');
  g2.appendChild(slider(params, 'pressure', { ja: '提按', en: 'pressure · lift↔press', min: 0, max: 1, step: 0.01 }, onChange));
  g2.appendChild(slider(params, 'sideTip', { ja: '中鋒↔側鋒', en: 'centred↔side tip', min: 0, max: 1, step: 0.01 }, onChange));
  g2.appendChild(slider(params, 'entryTip', { ja: '蔵鋒↔露鋒', en: 'hidden↔exposed', min: 0, max: 1, step: 0.01 }, onChange));
  body.appendChild(g2);

  const g3 = group('墨色 · ink & paper');
  g3.appendChild(slider(params, 'inkLoad', { ja: '墨量', en: 'ink load · wet→dry', min: 0, max: 1, step: 0.01 }, onChange));
  g3.appendChild(slider(params, 'dark', { ja: '濃淡', en: 'ink darkness', min: 0.3, max: 1, step: 0.005 }, onChange));
  g3.appendChild(slider(params, 'bleed', { ja: '滲み', en: 'nijimi · bleed', min: 0, max: 0.05, step: 0.0005, dp: 3 }, onChange));
  g3.appendChild(slider(params, 'kasure', { ja: '掠れ', en: 'kasure · dry brush', min: 0, max: 1, step: 0.01 }, onChange));
  g3.appendChild(slider(params, 'grain', { ja: '紙肌', en: 'paper grain', min: 0, max: 1.4, step: 0.01 }, onChange));
  body.appendChild(g3);

  root.appendChild(adv);
}
