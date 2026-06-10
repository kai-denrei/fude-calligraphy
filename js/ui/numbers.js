// numbers.js — stroke-order numerals on a 2D overlay aligned to the GL canvas
// (crisp + exportable; NOT in the shader). Each numeral sits at its stroke's start
// point, offset along the start-segment normal by ~half the brush width. (HANDOVER §F4.)

let canvas, ctx, dpr = 1;

export function mountNumbers(overlayCanvas) {
  canvas = overlayCanvas;
  ctx = canvas.getContext('2d');
}

export function resizeNumbers(W, H) {
  if (!canvas) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
}

// cells: [{char, glyph, x, y, size}] in logical px. on: bool. params: for brush width.
export function drawNumbers(cells, on, params = {}, target = ctx, clear = true) {
  if (!target) return;
  const c = target.canvas;
  target.setTransform(1, 0, 0, 1, 0, 0);
  // clear only the live overlay; for PNG export (clear=false) the canvas already
  // holds the composited GL render and must not be wiped.
  if (clear) target.clearRect(0, 0, c.width, c.height);
  if (!on) return;
  const sc = c.width / (c.__logicalW || (c.width / dpr)); // scale logical→backing
  const scy = c.height / (c.__logicalH || (c.height / dpr));

  // 1) place each numeral at its stroke origin, offset along the start-segment normal
  const labels = [];
  for (const cell of cells) {
    if (!cell.glyph) continue;
    const r = Math.max(5, cell.size * 0.04) * sc;        // smaller circle
    cell.glyph.strokes.forEach((st, i) => {
      const a = st.samples[0], b = st.samples[1] || st.samples[0];
      const gx = cell.x + a.x * cell.size, gy = cell.y + a.y * cell.size;
      const nx = -(b.y - a.y), ny = (b.x - a.x), nl = Math.hypot(nx, ny) || 1;
      const off = (params.width || 0.05) * cell.size * 0.9;
      labels.push({ x: (gx + (nx / nl) * off) * sc, y: (gy + (ny / nl) * off) * scy, r, n: i + 1, cell });
    });
  }
  // 2) neighbour awareness: relax overlaps within each glyph (push apart, gently)
  for (let iter = 0; iter < 16; iter++) {
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const A = labels[i], B = labels[j];
        if (A.cell !== B.cell) continue;                 // only de-clutter within a glyph
        let dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy);
        const min = (A.r + B.r) * 1.08;
        if (d > min) continue;
        if (d < 1e-3) { dx = (A.n - B.n) || 1; dy = 0.3; d = Math.hypot(dx, dy); } // coincident → split
        const push = (min - d) / 2, ux = dx / d, uy = dy / d;
        A.x -= ux * push; A.y -= uy * push; B.x += ux * push; B.y += uy * push;
      }
    }
  }
  // 3) draw
  for (const L of labels) {
    target.beginPath(); target.arc(L.x, L.y, L.r, 0, 7);
    target.fillStyle = 'rgba(12,11,10,0.8)'; target.fill();
    target.fillStyle = '#4fd0c4';
    target.font = `${Math.round(L.r * 1.15)}px "JetBrains Mono", monospace`;
    target.textAlign = 'center'; target.textBaseline = 'middle';
    target.fillText(String(L.n), L.x, L.y + L.r * 0.04);
  }
}
