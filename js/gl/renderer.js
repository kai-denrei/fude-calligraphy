// renderer.js — WebGL2 setup, median atlas, per-cell draw. (dev-owned; consumes the
// arch-owned shaders.js backbone.) Multi-glyph is native: one draw call per glyph
// cell, medians read from a float-texture atlas. N=1 is the trivial case.

import {
  PAPER_VERT, PAPER_FRAG, INK_VERT, INK_FRAG,
  SAMPLES_PER_STROKE, MAX_STROKES,
} from './shaders.js';

const NS = SAMPLES_PER_STROKE;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error('shader: ' + gl.getShaderInfoLog(s) + '\n' + src);
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS))
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  return p;
}

export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('WebGL2 unavailable');

  const paper = program(gl, PAPER_VERT, PAPER_FRAG);
  const ink = program(gl, INK_VERT, INK_FRAG);

  const Up = {};
  ['uRes', 'uGrain', 'uPaper'].forEach((n) => (Up[n] = gl.getUniformLocation(paper, n)));
  const Ui = {};
  ['uRect', 'uAtlas', 'uAtlasBase', 'uStrokeCount', 'uProg', 'uTermClass', 'uWidth', 'uPressure',
    'uSideTip', 'uEntryTip', 'uInkLoad', 'uBleed', 'uKasure', 'uWarp',
    'uDark', 'uInk', 'uShowSkel', 'uTime'].forEach((n) => (Ui[n] = gl.getUniformLocation(ink, n)));

  // unit quad (two triangles), attribute location 0 = aUnit
  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
  const aUnit = gl.getAttribLocation(ink, 'aUnit');
  gl.enableVertexAttribArray(aUnit);
  gl.vertexAttribPointer(aUnit, 2, gl.FLOAT, false, 0, 0);
  const empty = gl.createVertexArray();          // for the attribute-less paper pass

  const atlasTex = gl.createTexture();
  let atlasRows = 0;

  let W = canvas.clientWidth || 600, H = canvas.clientHeight || 600, dpr = 1;

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    const bw = Math.round(W * dpr), bh = Math.round(H * dpr);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
  }

  // cells: [{char, glyph:{strokes,strokeCount}|null, fallback}]. Builds the atlas,
  // dedupes by char, annotates each cell with {atlasBase, strokeCount}.
  function setGlyphs(cells) {
    const byChar = new Map();
    let rows = 0;
    for (const c of cells) {
      if (!c.glyph || byChar.has(c.char)) continue;
      byChar.set(c.char, rows);
      rows += c.glyph.strokeCount;
    }
    atlasRows = Math.max(rows, 1);
    const data = new Float32Array(NS * atlasRows * 4);
    for (const [char, base] of byChar) {
      const g = cells.find((c) => c.char === char).glyph;
      g.strokes.forEach((st, si) => {
        const row = base + si;
        st.samples.forEach((p, k) => {
          const o = (row * NS + k) * 4;
          data[o] = p.x; data[o + 1] = p.y; data[o + 2] = p.t; data[o + 3] = 1;
        });
      });
    }
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, NS, atlasRows, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    for (const c of cells) c.atlasBase = c.glyph ? byChar.get(c.char) : 0,
      c.strokeCount = c.glyph ? c.glyph.strokeCount : 0;
  }

  // rect in logical px {x,y,size} → NDC vec4(left,top,right,bottom)
  const rectNDC = (x, y, sz, w, h) => [
    (x / w) * 2 - 1, 1 - (y / h) * 2, ((x + sz) / w) * 2 - 1, 1 - ((y + sz) / h) * 2,
  ];

  function setBrush(p) {
    gl.uniform1f(Ui.uWidth, p.width);
    gl.uniform1f(Ui.uPressure, p.pressure);
    gl.uniform1f(Ui.uSideTip, p.sideTip);
    gl.uniform1f(Ui.uEntryTip, p.entryTip);
    gl.uniform1f(Ui.uInkLoad, p.inkLoad);
    gl.uniform1f(Ui.uBleed, p.bleed);
    gl.uniform1f(Ui.uKasure, p.kasure);
    gl.uniform1f(Ui.uWarp, p.warp);
    gl.uniform1f(Ui.uDark, p.dark);
    gl.uniform3fv(Ui.uInk, p.ink || [0.035, 0.03, 0.025]);
  }

  // state: {cells, params, paperOn, showSkel, time, width:logicalW, height:logicalH}
  function drawInto(state, vpW, vpH, logW, logH) {
    gl.viewport(0, 0, vpW, vpH);
    const p = state.params;
    if (state.paperOn !== false) {
      gl.useProgram(paper);
      gl.bindVertexArray(empty);
      gl.uniform2f(Up.uRes, vpW, vpH);
      gl.uniform1f(Up.uGrain, p.grain);
      gl.uniform3fv(Up.uPaper, p.paper || [0.913, 0.886, 0.812]);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else {
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.useProgram(ink);
    gl.bindVertexArray(quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(Ui.uAtlas, 0);
    gl.uniform1f(Ui.uShowSkel, state.showSkel ? 1 : 0);
    gl.uniform1f(Ui.uTime, state.time || 0);
    setBrush(p);
    gl.enable(gl.BLEND);
    // separate alpha factors → straight (non-premultiplied) alpha in the export FBO,
    // so transparent-PNG edges composite correctly (RGB over, alpha accumulates).
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const c of state.cells) {
      if (!c.glyph) continue;
      gl.uniform4fv(Ui.uRect, rectNDC(c.x, c.y, c.size, logW, logH));
      gl.uniform1i(Ui.uAtlasBase, c.atlasBase);
      gl.uniform1i(Ui.uStrokeCount, c.strokeCount);
      gl.uniform1fv(Ui.uProg, c.prog);              // Float32Array(MAX_STROKES)
      gl.uniform1fv(Ui.uTermClass, c.terminals);    // per-stroke 終筆 class
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.disable(gl.BLEND);
  }

  function draw(state) {
    drawInto(state, canvas.width, canvas.height, W, H);
  }

  // offscreen render at export scale → Uint8 RGBA (for PNG export, F7)
  function exportRGBA(state, scale = 2, transparent = false) {
    const w = Math.round(W * scale), h = Math.round(H * scale);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    drawInto({ ...state, paperOn: !transparent }, w, h, W, H);
    const px = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
    gl.viewport(0, 0, canvas.width, canvas.height);
    return { px, w, h };                          // px is bottom-up (GL order)
  }

  resize();
  return { gl, resize, setGlyphs, draw, exportRGBA, get size() { return { W, H, dpr }; }, MAX_STROKES };
}
