// metadata.js — embed/read a JSON payload inside a PNG via a `tEXt` chunk.
// The exported brush settings travel inside the .png itself: drop a fude-made PNG
// back in and the values restore. Payload is base64'd UTF-8 (so Japanese input text
// survives PNG's Latin-1 text constraint) under the keyword "fude".

const KEYWORD = 'fude';

// PNG CRC-32 (poly 0xEDB88320), table built once.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const u8 = (s) => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff; return a; };
const toB64 = (s) => btoa(unescape(encodeURIComponent(s)));     // utf8 string → ascii base64
const fromB64 = (b) => decodeURIComponent(escape(atob(b)));     // ← inverse

// insert a tEXt(fude) chunk just before IEND; returns a new Uint8Array
export function embedMetadata(arrayBuffer, jsonStr) {
  const png = new Uint8Array(arrayBuffer);
  const data = u8(KEYWORD + '\0' + toB64(jsonStr));
  const text = chunk('tEXt', data);
  const iend = png.length - 12;                                  // IEND is the final 12 bytes
  const out = new Uint8Array(png.length + text.length);
  out.set(png.subarray(0, iend), 0);
  out.set(text, iend);
  out.set(png.subarray(iend), iend + text.length);
  return out;
}

// read the fude payload from a PNG, or null
export function readMetadata(arrayBuffer) {
  const png = new Uint8Array(arrayBuffer);
  if (png.length < 8) return null;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p + 8 <= png.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    if (type === 'tEXt') {
      const data = png.subarray(p + 8, p + 8 + len);
      let z = 0; while (z < data.length && data[z] !== 0) z++;
      let kw = ''; for (let i = 0; i < z; i++) kw += String.fromCharCode(data[i]);
      if (kw === KEYWORD) {
        let b = ''; for (let i = z + 1; i < data.length; i++) b += String.fromCharCode(data[i]);
        try { return fromB64(b); } catch { return null; }
      }
    }
    if (type === 'IEND') break;
    p += 12 + len;
  }
  return null;
}
