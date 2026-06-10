#!/usr/bin/env node
// build-data.mjs — preprocess animCJK + kanji-data into the app's offline data.
//
// Inputs (in tools/.cache/, fetched once — see README):
//   graphicsJa.txt       animCJK kanji  : one JSON/line {character, strokes, medians}
//   graphicsJaKana.txt   animCJK kana   : same format
//   kanji.json           kanji-data     : {char: {grade, strokes, meanings, readings_*, jlpt_new}}
//
// Outputs (assets/data/):
//   medians.json     {char: {m:[[[x,y],...]...], n:strokeCount}}  (medians, stroke order)
//   index.json       {grades, kana, meta, english, counts, _attribution}
//   stroketypes.json {}  (KanjiVG per-stroke types deferred for V1 — see HANDOVER §7)
//
// Coordinate convention (validated against the PoC's known-good 中 medians):
//   animCJK medians are Makemeahanzi-format. Display space = (x, 900 - y), which
//   lands in the PoC's 0..1024 y-down space. This transform is applied here so the
//   shipped data is render-ready and the client never re-derives it.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE = join(__dirname, '.cache');
const OUT = join(ROOT, 'assets', 'data');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// --- config: which grades to bundle. 1–6 = kyōiku; 8 = the rest of the jōyō set
// (taught junior-high+, e.g. 柔 猫). Default = full jōyō. ---
const GRADES = (process.env.GRADES || '1,2,3,4,5,6,8').split(',').map(Number);

// --- 2020 kyōiku revision: grade reassignment (HANDOVER §F3) ---------------
// The bundled KANJIDIC2 vintage (tools/.cache/kanji.json) encodes the PRE-2020
// kyōiku split: grades 1–6 = 80/160/200/200/185/181 (1006 chars), with all 20
// prefecture (都道府県) kanji still at grade 8. The 2017-告示 / 2020-施行 revision
// re-balanced grades 4–6 to 202/193/191 (1026 chars total) by:
//   • adding the 20 prefecture kanji to grade 4 (they were grade 8 here),
//   • shifting compensating sets grade4→5 and grade5→6, plus 城/賀/富/群/徳
//     pulled grade5/6→4 to keep all prefecture-name characters at ≤ grade 4.
//
// GRADE_OVERRIDE below is NOT a hand-copied delta list (those circulate with
// errors — the commonly-seen "4→5 21 / 5→6 9" deltas under-count and yield
// 203/193/190). It was derived by DIFFING this cache against the COMPLETE
// official post-2020 per-grade tables (grade4=202, grade5=193, grade6=191,
// reproduced from MEXT's 学年別漢字配当表 via ieben.net / kanji1026.com and
// cross-checked with ja.wikipedia 学年別漢字配当表). Every entry is a char whose
// 2020 grade differs from its cache grade. Applying it reproduces the lists
// exactly (verified: 80/160/200/202/193/191). Grouped by move for review:
const GRADE_OVERRIDE = {
  // grade 8 → 4 : the 20 都道府県 prefecture kanji
  茨: 4, 媛: 4, 岡: 4, 潟: 4, 岐: 4, 熊: 4, 香: 4, 佐: 4, 埼: 4, 崎: 4,
  滋: 4, 鹿: 4, 縄: 4, 井: 4, 沖: 4, 栃: 4, 奈: 4, 梨: 4, 阪: 4, 阜: 4,
  // grade 6 → 4
  城: 4,
  // grade 5 → 4
  賀: 4, 富: 4, 群: 4, 徳: 4,
  // grade 4 → 5
  士: 5, 史: 5, 囲: 5, 告: 5, 毒: 5, 紀: 5, 型: 5, 航: 5, 殺: 5, 粉: 5,
  脈: 5, 救: 5, 停: 5, 堂: 5, 得: 5, 喜: 5, 象: 5, 貯: 5, 費: 5, 歴: 5, 賞: 5,
  // grade 4 → 6
  胃: 6, 腸: 6,
  // grade 5 → 6
  舌: 6, 券: 6, 承: 6, 退: 6, 恩: 6, 俵: 6, 預: 6, 銭: 6, 敵: 6,
};
// resolved grade: 2020 override if present, else the KANJIDIC2 (pre-2020) grade
const gradeOf = (ch) => GRADE_OVERRIDE[ch] ?? kanjiMeta[ch]?.grade ?? null;
// a few high-stroke demo glyphs for the dense-kanji smear test (F2), included if present
const DEMO = ['顔', '曜', '識', '護', '鬱', '薔', '龍', '鑑', '麗', '蘭', '鷹'];

// --- 学習 Learning Lists: curated vocab by theme (single kanji or words) -----------
// Each item renders on the canvas when picked; single kanji also show reading+meaning.
const LISTS = {
  numbers: {
    label: '数 · numbers',
    items: ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '百', '千', '万', '億', '兆'],
  },
  animals: {
    label: '動物 · animals',
    items: ['犬', '猫', '馬', '牛', '羊', '豚', '鹿', '象', '虎', '猿', '鳥', '兎', '熊'],
  },
  sea: {
    label: '海 · sea-life',
    items: ['魚', '貝', '鯨', '亀', '蟹', '蛸', '鯉', '鮫', '蝦', '海'],
  },
  food: {
    label: '食 · food',
    items: ['米', '肉', '魚', '卵', '豆', '茶', '酒', '塩', '飯', '菜', '麺', '餅', '果'],
  },
  philosophy: {
    label: '哲学 · philosophy',
    items: ['認識論', '存在論', '終末論', '倫理', '現象', '弁証法', '実存', '自由', '意志', '真理'],
  },
};
// glosses for multi-kanji words (single kanji glosses come from KANJIDIC2 meanings)
const LIST_GLOSS = {
  認識論: 'epistemology', 存在論: 'ontology', 終末論: 'eschatology', 倫理: 'ethics',
  現象: 'phenomenon', 弁証法: 'dialectic', 実存: 'existence', 自由: 'freedom',
  意志: 'will', 真理: 'truth',
};

const die = (m) => { console.error('FATAL:', m); process.exit(1); };
const readJSONL = (p) => {
  if (!existsSync(p)) die(`missing ${p} — fetch corpora first (see README "Rebuilding data")`);
  return readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
};

// --- load corpora ---
const kanjiRows = readJSONL(join(CACHE, 'graphicsJa.txt'));
const kanaRows = readJSONL(join(CACHE, 'graphicsJaKana.txt'));
const kanjiMeta = JSON.parse(readFileSync(join(CACHE, 'kanji.json'), 'utf8'));

const graphicsByChar = new Map();
for (const r of [...kanjiRows, ...kanaRows]) graphicsByChar.set(r.character, r);

// --- transform medians to display space (x, 900 - y), round to integers ---
const toDisplay = (medians) =>
  medians.map((stroke) => stroke.map(([x, y]) => [Math.round(x), Math.round(900 - y)]));

// --- KanjiVG paths (per stroke): clean kana medians + kanji terminal types. -------
// animCJK's kana medians are unreliable on loop strokes — 21 glyphs (あ お な は ま …)
// carry out-of-range points / wrong stroke counts. KanjiVG has canonical kana strokes,
// so we source kana medians from its <path> data (sampled), and reuse its kvg:type for
// kanji terminals. KanjiVG viewBox is 0..109, y-down (same orientation as our display).
const kvgByChar = new Map();   // char -> { paths:[d], types:[kvg:type|''] }
const KVG_PATH = join(CACHE, 'kanjivg.xml');
const haveKvg = existsSync(KVG_PATH);
if (haveKvg) {
  const xml = readFileSync(KVG_PATH, 'utf8');
  const blockRe = /<kanji id="kvg:kanji_([0-9a-fA-F]+)"[^>]*>([\s\S]*?)<\/kanji>/g;
  let b;
  while ((b = blockRe.exec(xml))) {
    const ch = String.fromCodePoint(parseInt(b[1], 16));
    const paths = [], types = [];
    for (const tag of b[2].match(/<path\b[^>]*>/g) || []) {
      const d = (tag.match(/\bd="([^"]+)"/) || [])[1];
      if (!d) continue;
      paths.push(d);
      types.push((tag.match(/kvg:type="([^"]+)"/) || [])[1] || '');
    }
    if (paths.length) kvgByChar.set(ch, { paths, types });
  }
} else {
  console.warn('tools/.cache/kanjivg.xml absent — kana medians fall back to animCJK (see README).');
}

// flatten an SVG path d (M/L/H/V/C/S/Q/Z, abs+rel) to a polyline of [x,y] points
function flattenPath(d, per = 8) {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, px = 0, py = 0, cmd = '';
  const num = () => parseFloat(toks[i++]);
  const out = [];
  const cubic = (x1, y1, x2, y2, x, y) => {
    for (let t = 1; t <= per; t++) {
      const u = t / per, m = 1 - u;
      out.push([m*m*m*cx + 3*m*m*u*x1 + 3*m*u*u*x2 + u*u*u*x,
                m*m*m*cy + 3*m*m*u*y1 + 3*m*u*u*y2 + u*u*u*y]);
    }
    cx = x; cy = y;
  };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
    if (C === 'M') { let x = num(), y = num(); if (rel) { x += cx; y += cy; } cx = sx = x; cy = sy = y; out.push([cx, cy]); cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') { let x = num(), y = num(); if (rel) { x += cx; y += cy; } cx = x; cy = y; out.push([cx, cy]); }
    else if (C === 'H') { let x = num(); if (rel) x += cx; cx = x; out.push([cx, cy]); }
    else if (C === 'V') { let y = num(); if (rel) y += cy; cy = y; out.push([cx, cy]); }
    else if (C === 'C') { let x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num(); if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; } px = x2; py = y2; cubic(x1, y1, x2, y2, x, y); }
    else if (C === 'S') { let x2 = num(), y2 = num(), x = num(), y = num(); if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; } cubic(2*cx - px, 2*cy - py, x2, y2, x, y); px = x2; py = y2; }
    else if (C === 'Q') { let x1 = num(), y1 = num(), x = num(), y = num(); if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; } for (let t = 1; t <= per; t++) { const u = t/per, m = 1 - u; out.push([m*m*cx + 2*m*u*x1 + u*u*x, m*m*cy + 2*m*u*y1 + u*u*y]); } px = x1; py = y1; cx = x; cy = y; }
    else if (C === 'Z') { cx = sx; cy = sy; }
    else i++;
  }
  return out;
}
const downsample = (pts, n) => {
  if (pts.length <= n) return pts;
  const out = [];
  for (let k = 0; k < n; k++) out.push(pts[Math.round(k * (pts.length - 1) / (n - 1))]);
  return out;
};
const KVG_SCALE = 1024 / 109;
function kvgKanaMedians(ch) {
  const e = kvgByChar.get(ch);
  if (!e) return null;
  return e.paths.map((d) => downsample(flattenPath(d), 18).map(([x, y]) => [Math.round(x * KVG_SCALE), Math.round(y * KVG_SCALE)]));
}

// --- target glyph set ---
const isHiragana = (cp) => cp >= 0x3041 && cp <= 0x3096;
const isKatakana = (cp) => (cp >= 0x30a1 && cp <= 0x30fa) || cp === 0x30fc;

const kanaChars = kanaRows
  .map((r) => r.character)
  .filter((ch) => { const cp = ch.codePointAt(0); return isHiragana(cp) || isKatakana(cp); });

const gradeChars = {};       // grade -> [char]
for (const g of GRADES) gradeChars[g] = [];
// iterate over every char that has a resolved (override-or-cache) grade, so the
// 20 prefecture kanji (grade 8 in cache, grade 4 in 2020) are picked up too.
for (const ch of new Set([...Object.keys(kanjiMeta), ...Object.keys(GRADE_OVERRIDE)])) {
  const g = gradeOf(ch);
  if (GRADES.includes(g) && graphicsByChar.has(ch)) gradeChars[g].push(ch);
}
// stable order: by stroke count then unicode, "simpler first" (brief F5 ranking)
for (const g of GRADES) {
  gradeChars[g].sort((a, b) => {
    const sa = kanjiMeta[a]?.strokes ?? 99, sb = kanjiMeta[b]?.strokes ?? 99;
    return sa - sb || a.codePointAt(0) - b.codePointAt(0);
  });
}

const demoChars = DEMO.filter((ch) => graphicsByChar.has(ch));
// every distinct kanji used by any learning list (so its medians/terminals get bundled)
const isKana = (ch) => isHiragana(ch.codePointAt(0)) || isKatakana(ch.codePointAt(0));
const listKanji = [...new Set(Object.values(LISTS).flatMap((l) => l.items).flatMap((it) => [...it]))]
  .filter((ch) => graphicsByChar.has(ch) && !isKana(ch));
const allKanji = [...new Set([...Object.values(gradeChars).flat(), ...demoChars, ...listKanji])];
const allChars = [...new Set([...kanaChars, ...allKanji])];

// --- medians.json (kana from KanjiVG, kanji from animCJK) ---
const medians = {};
let missing = 0, kvgKana = 0;
for (const ch of allChars) {
  if (isKana(ch)) {
    const km = kvgKanaMedians(ch);
    if (km && km.length) { medians[ch] = { m: km, n: km.length }; kvgKana++; continue; }
  }
  const g = graphicsByChar.get(ch);
  if (!g) { missing++; continue; }
  medians[ch] = { m: toDisplay(g.medians), n: g.medians.length };
}

// --- meta + english index ---
const meta = {};
const english = {};                       // keyword -> Set(char)
const addEnglish = (word, ch) => {
  const k = word.trim().toLowerCase();
  if (!k || k.length < 2) return;
  (english[k] ||= new Set()).add(ch);
};
for (const ch of allKanji) {
  const m = kanjiMeta[ch];
  if (!m) continue;
  meta[ch] = {
    g: gradeOf(ch),
    s: m.strokes ?? null,
    m: (m.meanings || []).slice(0, 6),
    on: (m.readings_on || []).slice(0, 4),
    kun: (m.readings_kun || []).slice(0, 4),
    j: m.jlpt_new ?? m.jlpt_old ?? null,
  };
  for (const meaning of m.meanings || []) {
    addEnglish(meaning, ch);                          // full phrase
    for (const w of meaning.split(/[^a-zA-Z]+/)) addEnglish(w, ch);  // tokens
  }
}
// rank candidates: grade asc (null last), then strokes asc (simpler first)
const rank = (set) => [...set].sort((a, b) => {
  const ga = meta[a]?.g ?? 99, gb = meta[b]?.g ?? 99;
  const sa = meta[a]?.s ?? 99, sb = meta[b]?.s ?? 99;
  return ga - gb || sa - sb;
}).slice(0, 16);
const englishOut = {};
for (const [k, set] of Object.entries(english)) englishOut[k] = rank(set);

// --- romaji reading index (F5 / 入力): type "inu" → 犬, "neko" → 猫, "ai" → 愛 -------
// On + kun readings (kana) → Hepburn-ish romaji → kanji. Okurigana after '.' dropped;
// '-' / 'ー' markers stripped; youon (small ゃゅょ) and sokuon (っ) handled.
const ROMA = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to', だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho', ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
};
const SY = { ゃ: 'ya', ゅ: 'yu', ょ: 'yo' };
const kataToHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCodePoint(c.codePointAt(0) - 0x60));
function toRomaji(reading) {
  const r = kataToHira(reading.split('.')[0].replace(/[-ー・]/g, ''));
  let out = '', dbl = false;
  for (let i = 0; i < r.length; i++) {
    const c = r[i], nx = r[i + 1];
    if (c === 'っ') { dbl = true; continue; }
    let syl;
    if (SY[nx]) {
      const b = ROMA[c] || '';
      const v = { ya: 'a', yu: 'u', yo: 'o' }[SY[nx]];
      syl = (b === 'shi') ? 'sh' + v : (b === 'chi') ? 'ch' + v : (b === 'ji') ? 'j' + v : b.slice(0, -1) + SY[nx];
      i++;
    } else syl = ROMA[c] ?? '';
    if (dbl && syl) { out += syl[0]; dbl = false; }
    out += syl;
  }
  return out;
}
const romaji = {};
for (const ch of allKanji) {
  const m = kanjiMeta[ch];
  if (!m) continue;
  for (const rd of [...(m.readings_on || []), ...(m.readings_kun || [])]) {
    const r = toRomaji(rd);
    if (r.length >= 1) (romaji[r] ||= new Set()).add(ch);
  }
}
const romajiOut = {};
for (const [r, set] of Object.entries(romaji)) romajiOut[r] = rank(set);

// --- kana split ---
const hiragana = kanaChars.filter((ch) => isHiragana(ch.codePointAt(0)));
const katakana = kanaChars.filter((ch) => isKatakana(ch.codePointAt(0)));

const index = {
  grades: gradeChars,
  kana: { hiragana, katakana },
  meta,
  english: englishOut,
  romaji: romajiOut,
  lists: Object.fromEntries(Object.entries(LISTS).map(([k, v]) => [k, {
    label: v.label,
    items: v.items.map((it) => ({
      t: it,                                                       // text to render
      g: LIST_GLOSS[it] || (it.length === 1 ? (meta[it]?.m?.[0] || '') : ''),   // gloss
      r: it.length === 1 ? (meta[it]?.kun?.[0] || meta[it]?.on?.[0] || '') : '', // reading (single kanji)
    })),
  }])),
  counts: {
    glyphs: allChars.length,
    kanji: allKanji.length,
    kana: kanaChars.length,
    ...Object.fromEntries(GRADES.map((g) => [`grade${g}`, gradeChars[g].length])),
    englishKeys: Object.keys(englishOut).length,
    romajiKeys: Object.keys(romajiOut).length,
  },
  _attribution: {
    medians: 'animCJK (parsimonhi/animCJK) — Makemeahanzi/Arphic lineage; corrected stroke order.',
    meta: 'KANJIDIC2 © EDRDG, CC BY-SA 4.0, via davidluzgouveia/kanji-data.',
    strokeTypes: 'KanjiVG (kanjivg.tagaini.net) — per-stroke kvg:type → terminal class. CC BY-SA 3.0.',
  },
};

// --- KanjiVG per-stroke terminal classes (F1) ---------------------------------
// kvg:type → terminal class: 0 tome 止め, 1 hane はね, 2 harai-left 左払い,
// 3 harai-right 右払い, 4 dot 点. Rule: take the primary slash-alternate, strip
// a/b/c/v variant suffix, decode the FINAL CJK-stroke component by its Unicode
// stroke name (gōu/tí→hane, nà→harai-R, piě→harai-L, diǎn→dot, else tome). The
// table below is the data-validated reduction over the bundled corpus (0 unmapped).
const CJK_STROKE = (ch) => { const cp = ch.codePointAt(0); return (cp >= 0x31c0 && cp <= 0x31e3) || cp === 0x4e85; };
const FINAL_CLASS = {
  '㇀': 1, '㇂': 1, '㇃': 1, '㇄': 0, '㇅': 0, '㇆': 1, '㇇': 2, '㇈': 1, '㇉': 1, '㇊': 1,
  '㇋': 2, '㇌': 1, '㇍': 0, '㇎': 1, '㇏': 3, '㇐': 0, '㇑': 0, '㇒': 2, '㇓': 2, '㇔': 4,
  '㇕': 0, '㇖': 1, '㇗': 0, '㇘': 0, '㇙': 1, '㇚': 1, '㇛': 4, '㇜': 0, '㇝': 1, '㇞': 0,
  '㇟': 1, '亅': 1,
};
const classifyType = (t) => {
  t = t.split('/')[0].replace(/[abcv]+$/, '');     // primary alternate, strip variant suffix
  let fin = '';
  for (const c of t) if (CJK_STROKE(c)) fin = c;     // last CJK-stroke component
  return FINAL_CLASS[fin] ?? 0;                      // default 止め
};

const strokeTypes = {};   // char -> [terminal class per stroke]   (reuses kvgByChar)
if (haveKvg) {
  let aligned = 0, mismatch = 0;
  for (const ch of allKanji) {
    const e = kvgByChar.get(ch), g = graphicsByChar.get(ch);
    if (!e || !g) continue;
    if (e.types.length !== g.medians.length) { mismatch++; continue; }   // alignment gate
    strokeTypes[ch] = e.types.map(classifyType);
    aligned++;
  }
  console.log(`KanjiVG terminals: ${aligned} aligned, ${mismatch} stroke-count mismatch (→ geometric fallback). Kana medians: ${kvgKana} from KanjiVG.`);
}

// --- write ---
writeFileSync(join(OUT, 'medians.json'), JSON.stringify(medians));
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index));
writeFileSync(join(OUT, 'stroketypes.json'), JSON.stringify(strokeTypes));

console.log('build-data complete');
console.table(index.counts);
if (missing) console.warn(`(${missing} target glyphs missing from corpora — skipped)`);
const sz = (p) => (readFileSync(p).length / 1024).toFixed(1) + ' KB';
console.log('medians.json', sz(join(OUT, 'medians.json')), '| index.json', sz(join(OUT, 'index.json')));
