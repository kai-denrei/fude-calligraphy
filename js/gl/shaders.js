// shaders.js — GLSL backbone (arch-owned). Atlas-native, every 用筆 parameter has a
// uniform from day one so feature work maps UI→uniforms without editing this file.
//
// Two programs:
//   PAPER — one fullscreen triangle, washi surface (grain, fiber, vignette).
//   INK   — one quad per glyph cell. Medians come from a float-texture atlas
//           (RGBA32F, NEAREST); coverage is an SDF threshold; ink is synthesized.
//           Output is premultiplied-ish (color, coverage) blended over the paper.
//
// The ink core, kasure-in-(t,across)-frame, and density mottle are ported from the
// validated PoC. The bleed is REPLACED with the ink-load depletion model (HANDOVER
// §F1 墨量 / §7): bleed amplitude ∝ remaining ink, concentrated at 起筆 (entry),
// with a high-freq capillary noise only at the wet frontier — not a uniform widen.

export const SAMPLES_PER_STROKE = 24; // NS — resample resolution per stroke
export const MAX_STROKES = 34;        // covers the densest kyōiku glyphs

// ---- shared noise (lifted verbatim from the PoC) ----
const NOISE = /* glsl */ `
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);float a=hash(i),b=hash(i+vec2(1,0)),
  c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));vec2 u=f*f*(3.-2.*f);
  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);
  for(int i=0;i<5;i++){s+=a*vnoise(p);p=m*p;a*=.5;}return s;}
`;

// ============================ PAPER ============================
export const PAPER_VERT = /* glsl */ `#version 300 es
void main(){ vec2 p=vec2((gl_VertexID==2)?3.:-1.,(gl_VertexID==1)?3.:-1.); gl_Position=vec4(p,0,1); }`;

export const PAPER_FRAG = /* glsl */ `#version 300 es
precision highp float;
out vec4 frag;
uniform vec2 uRes;
uniform float uGrain;
uniform vec3 uPaper;
${NOISE}
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = vec2(uv.x, 1.0 - uv.y);
  float fiber = fbm(p*vec2(210.,11.))*.5 + fbm(p*vec2(11.,210.))*.5;
  float grain = fbm(p*430.);
  vec3 col = uPaper;
  col -= (grain*0.05 + fiber*0.045) * uGrain;
  col -= 0.018 * smoothstep(0.4, 1.15, length(uv-0.5));   // faint vignette into paper
  frag = vec4(col, 1.0);
}`;

// ============================ INK ============================
export const INK_VERT = /* glsl */ `#version 300 es
in vec2 aUnit;            // unit quad, (0,0)=top-left .. (1,1)=bottom-right
uniform vec4 uRect;       // NDC: x=left, y=top, z=right, w=bottom
out vec2 vUv;
void main(){
  vUv = aUnit;
  gl_Position = vec4(mix(uRect.x,uRect.z,aUnit.x), mix(uRect.y,uRect.w,aUnit.y), 0., 1.);
}`;

export const INK_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 frag;

uniform sampler2D uAtlas;   // RGBA32F medians: texel (k, base+s) = (x, y, t, _)
uniform int   uAtlasBase;   // first atlas row for this glyph
uniform int   uStrokeCount;
uniform float uProg[${MAX_STROKES}];

// 用筆 parameters (all present from day one)
uniform float uWidth;       // 筆幅 base half-width (glyph-local units)
uniform float uPressure;    // 提按 lift↔press, width-dynamics depth
uniform float uSideTip;     // 中鋒↔側鋒 0=centered 1=side (asymmetric)
uniform float uEntryTip;    // 蔵鋒↔露鋒 0=hidden/round 1=exposed/sharp
uniform float uTermClass[${MAX_STROKES}]; // 終筆 per stroke: 0止め 1はね 2左払い 3右払い 4点
uniform float uInkLoad;     // 墨量 wet↔dry budget (1=wet)
uniform float uBleed;       // にじみ amplitude
uniform float uKasure;      // かすれ dry-brush amount
uniform float uWarp;        // edge warp
uniform float uDark;        // 濃淡 ink darkness
uniform vec3  uInk;         // ink color (dark)
uniform float uShowSkel;    // diagnostic: median skeleton
uniform float uTime;

const int NS = ${SAMPLES_PER_STROKE};
const int MAXS = ${MAX_STROKES};
${NOISE}

// 終筆 — width multiplier along the stroke, per terminal class. For 右払い/点 this
// shapes the WHOLE stroke (not just the exit): 右払い presses then releases (footed),
// 点 is a plump bell. Terminal is a property of each stroke's type (from KanjiVG),
// not its position — driven per stroke by uTermClass[s].
float exitProfile(float t, float term){
  if(term < 0.5) return 1.0 - 0.08*smoothstep(0.90,1.0,t);                                   // 0 止め stop
  if(term < 1.5) return (1.0 + 0.10*smoothstep(0.72,0.90,t)) * (1.0 - 0.80*smoothstep(0.90,1.0,t)); // 1 はね hook
  if(term < 2.5) return 1.0 - smoothstep(0.42,1.0,t);                                         // 2 左払い even taper→point
  if(term < 3.5) return (0.78 + 0.50*smoothstep(0.05,0.80,t)) * (1.0 - smoothstep(0.84,1.0,t)); // 3 右払い press→foot→point
  return 0.62 + 0.58*sin(3.14159*clamp(t,0.,1.));                                             // 4 点 plump dot
}

float widthProfile(float t, float term){
  // 蔵鋒↔露鋒 entry: hidden = rounded ramp; exposed = sharp point
  float entry = mix(smoothstep(0.0,0.16,t), smoothstep(0.0,0.035,t), uEntryTip);
  if(term > 3.5) return exitProfile(t, term);    // 点 is plump from the start (no slow entry)
  return entry * exitProfile(t, term);
}

// Evaluate stroke s at p and pick the segment where p sits DEEPEST inside (max signed
// clearance wEff-dd). For a normal stroke this is just the nearest segment → its t varies
// smoothly, so the warp/texture stays continuous (no beading). At a self-crossing the wider
// body segment outranks a nearby tapering one (its clearance is larger) → no false pinch.
// Clearance is monotonic and never saturates, unlike a coverage smoothstep. Reports whether
// p is inside the core (oinside) and the min distance (skeleton). Only considers revealed
// segments so the stroke draws in stroke order.
void bestSeg(vec2 p, int s, float term, float prog,
             out float od, out float ot, out float oa, out float owEff, out float oinside, out float ogmin){
  float bestClr = -1e30; od=1e9; ot=0.; oa=0.; owEff=1e-4; ogmin=1e9; oinside=0.;
  int base = uAtlasBase + s;
  for(int k=0;k<NS-1;k++){
    vec3 A = texelFetch(uAtlas, ivec2(k,   base), 0).xyz;
    vec3 B = texelFetch(uAtlas, ivec2(k+1, base), 0).xyz;
    vec2 pa = p-A.xy, ba = B.xy-A.xy;
    float h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-8), 0., 1.);
    float dd = length(p-(A.xy+ba*h));
    ogmin = min(ogmin, dd);
    float tt = mix(A.z,B.z,h);
    float reveal = 1.0 - smoothstep(prog-0.035, prog, tt);
    if(reveal <= 0.0) continue;                                      // not yet drawn
    float across = (pa.x*ba.y - pa.y*ba.x)/max(length(ba),1e-6);
    float pres = 1.0 + uPressure*(0.55*sin(3.14159*tt) - 0.12);
    float w = uWidth * widthProfile(tt, term) * pres;
    float wEff = w * (1.0 + uSideTip*0.55*clamp(across/max(w,1e-4), -1.0, 1.0));
    float clr = wEff - dd;                                           // signed clearance (monotonic)
    if(clr > bestClr){ bestClr=clr; od=dd; ot=tt; oa=across; owEff=wEff; }
  }
  oinside = bestClr > 0.0 ? 1.0 : 0.0;
}

void main(){
  vec2 p = vUv;                          // glyph-local, y-down (matches median data)
  vec3 ink = mix(vec3(0.30,0.27,0.235), uInk, uDark);
  vec3 col = ink; float cover = 0.0;     // accumulated ink over transparent
  float gMin = 1e9;

  for(int s=0;s<MAXS;s++){
    if(s>=uStrokeCount) break;
    float prog = uProg[s];
    float term = uTermClass[s];
    // pick the segment p sits deepest inside (width-aware) so self-crossings don't pinch
    float d,t,across,wEff,inside,gm;
    bestSeg(p, s, term, prog, d, t, across, wEff, inside, gm);
    gMin = min(gMin, gm);
    if(d > 1e8) continue;                          // nothing revealed on this stroke at p
    if(inside < 0.5 && uBleed <= 0.0001) continue; // outside the core & no halo to draw
    float reveal = 1.0 - smoothstep(prog-0.035, prog, t);

    // --- ink-load depletion: wet at 起筆, drying toward 収筆 ---
    float wet = clamp(uInkLoad*(1.0 - smoothstep(0.0,0.85,t)) + 0.08, 0.0, 1.0);

    // --- にじみ bleed: feathered halo ∝ wet, low-freq warp + capillary frontier ---
    if(uBleed>0.0001 && wet>0.01){
      float lf = (fbm(p*9.0 + vec2(float(s)*4.1, uTime*0.03)) - 0.5);   // low-freq creep
      float hf = (fbm(p*47.0 + vec2(float(s)*2.7, t*7.0)) - 0.5);       // capillary frontier
      float bw = uBleed * wet;
      float bd = d + lf*uWarp*2.4;
      float halo = 1.0 - smoothstep(wEff, wEff+bw, bd);                 // soft outer halo (defined)
      float frontier = smoothstep(0.55,0.95, halo) * (1.0-smoothstep(0.95,1.0,halo)); // edge band
      halo *= (1.0 + hf*0.6*frontier);                                  // fibers only at frontier
      float ba = clamp(halo,0.,1.) * reveal * 0.34 * (0.5+0.5*wet);
      col = mix(col, ink, ba); cover = max(cover, ba);
    }

    // --- core coverage: warped SDF threshold ---
    float warp = (fbm(p*23.0 + vec2(float(s)*7.3, t*6.0)) - 0.5);
    float dw = d + warp*uWarp;
    float cov = (1.0 - smoothstep(wEff-0.004, wEff, dw)) * reveal;  // 1 inside stroke (defined)

    // --- かすれ dry-brush: streaks along stroke, worse where ink has run out ---
    float dry = uKasure * (0.35 + 0.65*smoothstep(0.4,1.0,t)) * (1.0 - 0.7*wet);
    float kn = fbm(vec2(t*52.0, across*68.0));
    float edgeBias = smoothstep(0.35,1.0, d/max(wEff,1e-4));
    float holes = smoothstep(0.55,0.78,kn)*dry + edgeBias*dry*0.5;
    cov *= clamp(1.0-holes, 0., 1.);

    // --- density: darker at 起筆, mottled ---
    float dens = mix(1.0,0.74, smoothstep(0.0,0.6,t));
    dens *= 0.84 + 0.32*fbm(p*38.0 + float(s)*3.0);

    cov = clamp(cov,0.,1.);
    col = mix(col, ink*dens, cov);
    cover = max(cover, cov);
  }

  if(uShowSkel>0.5){
    float sk = 1.0 - smoothstep(0.003,0.006, gMin);
    col = mix(col, vec3(0.31,0.84,0.79), sk*0.92);
    cover = max(cover, sk*0.92);
  }
  frag = vec4(col, cover);
}`;
