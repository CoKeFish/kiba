#!/usr/bin/env node
/**
 * Genera un PNG fuente 1024x1024 con un degradado simple en paleta Solana
 * (negro #0a0a0a → verde #14F195). Sin dependencias externas — usa solo
 * node:zlib y el spec de PNG.
 *
 * Uso: node gen-source-icon.mjs > app-icon.png
 *
 * Después de instalar Rust + tauri-cli, generar todos los tamaños con:
 *   npm run tauri icon app-icon.png
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const W = 1024;
const H = 1024;

function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

// Generar buffer RGB con un círculo verde sobre fondo negro
const raw = Buffer.alloc(H * (1 + W * 3));
const cx = W / 2, cy = H / 2;
const r1 = W * 0.42; // borde del círculo
const r0 = W * 0.36; // borde interno (suaviza el edge)

for (let y = 0; y < H; y++) {
  raw[y * (1 + W * 3)] = 0; // filter byte = none
  for (let x = 0; x < W; x++) {
    const dx = x - cx, dy = y - cy;
    const d = Math.sqrt(dx * dx + dy * dy);
    let r, g, b;
    if (d > r1) {
      r = 10; g = 10; b = 10;          // bg #0a0a0a
    } else if (d < r0) {
      r = 20; g = 241; b = 149;        // accent #14F195
    } else {
      const t = 1 - (d - r0) / (r1 - r0);
      r = lerp(10, 20, t);
      g = lerp(10, 241, t);
      b = lerp(10, 149, t);
    }
    const idx = y * (1 + W * 3) + 1 + x * 3;
    raw[idx] = r;
    raw[idx + 1] = g;
    raw[idx + 2] = b;
  }
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

// CRC32 (PNG spec)
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = (crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xffffffff) >>> 0;
}

const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 2;  // color type: RGB
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // compression / filter / interlace

const idat = deflateSync(raw, { level: 9 });

const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', idat),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = process.argv[2] ?? 'app-icon.png';
writeFileSync(out, png);
process.stderr.write(`wrote ${out} (${png.length} bytes)\n`);
