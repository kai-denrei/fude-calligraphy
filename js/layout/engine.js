// engine.js — string → glyph cells. Grid (横書き, wrap) + 縦書き (tategaki) vertical.
// Returns cells in LOGICAL px within a (W×H) canvas; main.js attaches the resolved
// glyph + fallback flag. Even cells, consistent centring. (HANDOVER §F2.)

const isWS = (ch) => /\s/.test(ch);

export function layout(str, opts = {}) {
  const {
    W = 600, H = 600, cell = 220, gap = 0.08, mode = 'grid', cols = 0,
  } = opts;
  const step = cell * (1 + gap);
  const tokens = [...str].filter((c) => !isWS(c));   // matches main.js sizing; no grid holes
  const cells = [];

  if (mode === 'tate') {
    // columns right-to-left, glyphs top-to-bottom
    const perCol = cols > 0 ? cols : Math.max(1, Math.floor(H / step));
    const nCols = Math.ceil(tokens.length / perCol) || 1;
    tokens.forEach((ch, i) => {
      const col = Math.floor(i / perCol), row = i % perCol;
      if (isWS(ch)) return;
      cells.push({ char: ch, index: i, col: nCols - 1 - col, row, _grid: { col: nCols - 1 - col, row }, size: cell });
    });
    const blockW = nCols * step, blockH = perCol * step;
    const ox = (W - blockW) / 2, oy = (H - blockH) / 2;
    for (const c of cells) { c.x = ox + c._grid.col * step + (step - cell) / 2; c.y = oy + c._grid.row * step + (step - cell) / 2; delete c._grid; }
    return cells;
  }

  // grid (横書き): left-to-right, wrap
  const perRow = cols > 0 ? cols : Math.max(1, Math.floor(W / step));
  const nRows = Math.ceil(tokens.length / perRow) || 1;
  tokens.forEach((ch, i) => {
    const row = Math.floor(i / perRow), col = i % perRow;
    if (isWS(ch)) return;
    cells.push({ char: ch, index: i, size: cell, _grid: { col, row } });
  });
  const usedCols = Math.min(perRow, tokens.length);
  const blockW = usedCols * step, blockH = nRows * step;
  const ox = (W - blockW) / 2, oy = (H - blockH) / 2;
  for (const c of cells) { c.x = ox + c._grid.col * step + (step - cell) / 2; c.y = oy + c._grid.row * step + (step - cell) / 2; delete c._grid; }
  return cells;
}
