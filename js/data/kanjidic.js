// kanjidic.js — grade lists (F3) + English→kanji index (F5) + per-kanji meta.
// Loads the prebaked assets/data/index.json (built by tools/build-data.mjs from
// KANJIDIC2-derived kanji-data). Offline by default. (HANDOVER §F3/§F5.)

import { withV } from '../util/version.js';

let IDX = null;

export async function loadIndex() {
  if (IDX) return IDX;
  const res = await fetch(withV('assets/data/index.json'));
  if (!res.ok) throw new Error(`index.json ${res.status}`);
  IDX = await res.json();
  return IDX;
}

export const grades = () => Object.keys(IDX?.grades || {}).map(Number).sort((a, b) => a - b);
export const byGrade = (g) => (IDX?.grades?.[g] || []).slice();
export const kana = () => IDX?.kana || { hiragana: [], katakana: [] };
export const meta = (ch) => IDX?.meta?.[ch] || null;
export const counts = () => IDX?.counts || {};
export const lists = () => IDX?.lists || {};
export const attribution = () => IDX?._attribution || {};

// search('cat'|'inu') → [char,...]. English MEANING + romaji READING, exact-first
// (so "cat" → 猫, not "catch" → 移), with a prefix fallback only when nothing exact.
export function search(word) {
  if (!IDX) return [];
  const k = word.trim().toLowerCase();
  if (!k) return [];
  const out = [], seen = new Set();
  const add = (arr) => { for (const ch of arr || []) if (!seen.has(ch)) { seen.add(ch); out.push(ch); } };
  if (IDX.english[k]) add(IDX.english[k]);          // exact english meaning
  if (IDX.romaji && IDX.romaji[k]) add(IDX.romaji[k]); // exact romaji reading
  if (!out.length) {                                 // fallback: prefix match
    for (const key of Object.keys(IDX.english)) { if (key.startsWith(k)) add(IDX.english[key]); if (out.length >= 24) break; }
    for (const key of Object.keys(IDX.romaji || {})) { if (key.startsWith(k)) add(IDX.romaji[key]); if (out.length >= 24) break; }
  }
  return out.slice(0, 24);
}
export const searchEnglish = search;   // back-compat alias
