// png.js — PNG export (F7). Composites the WebGL render (offscreen FBO at export
// scale) + the stroke-number overlay into one image. Background: washi (default) or
// transparent (alpha). (HANDOVER §F7.)

import { drawNumbers } from '../ui/numbers.js';
import { embedMetadata } from './metadata.js';

export async function exportPNG(renderer, state, opts = {}) {
  const { scale = 2, transparent = false, withNumbers = false, params = {}, save = null } = opts;
  const { px, w, h } = renderer.exportRGBA(state, scale, transparent);

  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');

  // GL pixels are bottom-up; flip into ImageData
  const img = ctx.createImageData(w, h);
  const row = w * 4;
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * row;
    img.data.set(px.subarray(src, src + row), y * row);
  }
  ctx.putImageData(img, 0, 0);

  if (withNumbers) {
    out.__logicalW = renderer.size.W; out.__logicalH = renderer.size.H;
    drawNumbers(state.cells, true, params, ctx, false);  // don't clear the composited render
  }

  let blob = await new Promise((res) => out.toBlob(res, 'image/png'));
  if (save) {                                          // embed the brush settings in the PNG
    const withMeta = embedMetadata(await blob.arrayBuffer(), JSON.stringify(save));
    blob = new Blob([withMeta], { type: 'image/png' });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `fude-${Date.now()}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
