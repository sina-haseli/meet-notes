// Generates icons/16,32,48,128.png with no dependencies: node zlib + a hand-written PNG encoder.
// Usage: node scripts/make-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "latin1");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const C1 = [0x4f, 0x46, 0xe5];
const C2 = [0x93, 0x33, 0xea];

// Signed distance (in px) to a rounded rect centred at (cx, cy) with half-size (hw, hh) and radius r.
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - (hw - r);
  const qy = Math.abs(y - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}
const cover = (d) => Math.min(1, Math.max(0, 0.5 - d)); // 1px antialias ramp

function render(size) {
  const s = size;
  const buf = Buffer.alloc(s * s * 4);
  const SS = 4; // supersampling per axis
  const bars = [
    { cx: 0.62, h: 0.2 },
    { cx: 0.74, h: 0.36 },
    { cx: 0.86, h: 0.26 },
  ];
  for (let py = 0; py < s; py++) {
    for (let px = 0; px < s; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          const bg = cover(sdRoundRect(x, y, s / 2, s / 2, s / 2, s / 2, s * 0.22) * 1);
          if (bg === 0) continue;
          const t = (x + y) / (2 * s);
          let col = [0, 1, 2].map((i) => C1[i] + (C2[i] - C1[i]) * t);
          let white = 0;
          white = Math.max(white, Math.hypot(x - 0.3 * s, y - 0.5 * s) <= 0.13 * s ? 1 : 0);
          for (const bar of bars) {
            white = Math.max(
              white,
              sdRoundRect(x, y, bar.cx * s, 0.5 * s, 0.035 * s, bar.h * s, 0.035 * s) <= 0 ? 1 : 0,
            );
          }
          col = col.map((c) => c + (255 - c) * white);
          r += col[0] * bg; g += col[1] * bg; b += col[2] * bg; a += bg;
        }
      }
      const n = SS * SS;
      const o = (py * s + px) * 4;
      if (a > 0) {
        buf[o] = Math.round(r / a);
        buf[o + 1] = Math.round(g / a);
        buf[o + 2] = Math.round(b / a);
        buf[o + 3] = Math.round((a / n) * 255);
      }
    }
  }
  return buf;
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(dir, `${size}.png`), encodePng(size, render(size)));
  console.log(`wrote icons/${size}.png`);
}
