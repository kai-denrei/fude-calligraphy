// browser.js — 学習 learning lists + grade/kana browse + english/romaji search.
// mountBrowser(root, { onPick }): clicking a glyph / card / chip calls onPick(text).

import { grades, byGrade, kana, meta, search, counts, lists } from '../data/kanjidic.js';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const sec = (txt) => el('div', 'browse-sec', txt);

export function mountBrowser(root, { onPick }) {
  root.innerHTML = '';

  // ---- search (F5): English meaning OR romaji reading → kanji ----
  const searchBox = el('div', 'engsearch');
  searchBox.innerHTML = `<input type="text" id="engInput" placeholder="english / romaji → kanji  ·  cat · inu · neko" autocomplete="off" spellcheck="false">`;
  const chips = el('div', 'chips');
  searchBox.querySelector('input').addEventListener('input', (e) => {
    chips.innerHTML = '';
    for (const ch of search(e.target.value).slice(0, 18)) {
      const m = meta(ch);
      const badge = m?.g === 8 ? '中' : (m?.g ? String(m.g) : '');
      const chip = el('button', 'chip', `<span class="cch">${ch}</span><span class="cmeta">${badge}</span>`);
      chip.title = m ? (m.m || []).slice(0, 2).join(', ') : ch;
      chip.addEventListener('click', () => onPick(ch));
      chips.appendChild(chip);
    }
  });

  // shared containers
  const listTabs = el('div', 'tabs');
  const listGrid = el('div', 'listgrid');
  const gradeTabs = el('div', 'tabs');
  const gridWrap = el('div', 'glyphgrid');

  // ---- 学習 learning lists (study cards: glyph + reading + meaning) ----
  const LS = lists();
  function showList(key) {
    [...listTabs.children].forEach((c) => c.classList.toggle('on', c.dataset.key === key));
    [...gradeTabs.children].forEach((c) => c.classList.remove('on'));
    gridWrap.innerHTML = ''; listGrid.innerHTML = '';
    for (const it of (LS[key]?.items || [])) {
      const card = el('button', 'lcard' + (it.t.length > 1 ? ' word' : ''),
        `<span class="lch">${it.t}</span><span class="lrd">${it.r || ''}</span><span class="lgl">${it.g || ''}</span>`);
      card.title = `${it.t}${it.r ? ' · ' + it.r : ''}${it.g ? ' · ' + it.g : ''}`;
      card.addEventListener('click', () => onPick(it.t));
      listGrid.appendChild(card);
    }
  }
  Object.entries(LS).forEach(([key, l]) => {
    const b = el('button', 'tab', l.label.split(' · ')[0]); b.dataset.key = key; b.title = l.label;
    b.addEventListener('click', () => showList(key));
    listTabs.appendChild(b);
  });

  // ---- 字典 grade / kana browse (F3) ----
  const tabs = [
    ...grades().map((g) => ({ key: `g${g}`, label: g === 8 ? '中学' : `${g}年`, chars: () => byGrade(g) })),
    { key: 'hira', label: 'ひら', chars: () => kana().hiragana },
    { key: 'kata', label: 'カタ', chars: () => kana().katakana },
  ];
  function showTab(t) {
    [...gradeTabs.children].forEach((c) => c.classList.toggle('on', c.dataset.key === t.key));
    [...listTabs.children].forEach((c) => c.classList.remove('on'));
    listGrid.innerHTML = ''; gridWrap.innerHTML = '';
    for (const ch of t.chars()) {
      const m = meta(ch);
      const cell = el('button', 'gcell', `<span class="gch">${ch}</span>`);
      cell.title = m ? `${ch} · ${(m.m || []).slice(0, 2).join(', ')}${m.s ? ` · ${m.s}画` : ''}` : ch;
      cell.addEventListener('click', () => onPick(ch));
      gridWrap.appendChild(cell);
    }
  }
  tabs.forEach((t) => {
    const b = el('button', 'tab', t.label); b.dataset.key = t.key;
    b.addEventListener('click', () => showTab(t));
    gradeTabs.appendChild(b);
  });

  const c = counts();
  const foot = el('div', 'browser-foot', `${c.kanji || 0} kanji (jōyō) · ${c.kana || 0} kana · ${c.englishKeys || 0} english · ${c.romajiKeys || 0} romaji`);

  root.appendChild(searchBox); root.appendChild(chips);
  root.appendChild(sec('学習 · learning lists')); root.appendChild(listTabs); root.appendChild(listGrid);
  root.appendChild(sec('字典 · browse')); root.appendChild(gradeTabs); root.appendChild(gridWrap);
  root.appendChild(foot);

  if (Object.keys(LS).length) showList(Object.keys(LS)[0]);   // land on the first list
  else showTab(tabs[0]);
}
