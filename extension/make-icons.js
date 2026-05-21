/**
 * Generates icons/16.png, icons/48.png, icons/128.png
 * Pure Node.js — no npm packages needed.
 */
import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync } from 'fs';

// CRC32
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[i] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.allocUnsafe(4); lenBuf.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([t, data]);
  const crcBuf = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([lenBuf, t, data, crcBuf]);
}

function makePng(size, pixelFn) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = ihdr[11] = ihdr[12] = 0; // RGBA, no compression/filter/interlace

  const raw = Buffer.allocUnsafe(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    raw[y * (1 + size * 4)] = 0; // filter: None
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelFn(x, y, size);
      const off = y * (1 + size * 4) + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = a;
    }
  }

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Pin shape: circle body + teardrop tail, indigo (#6366f1)
function pinPixel(x, y, size) {
  const cx = size / 2;
  const cy = size * 0.40;
  const r = size * 0.30;

  // Smooth distance helper
  const dx = x + 0.5 - cx;
  const dy = y + 0.5 - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Circle
  const edge = 1.2;
  if (dist < r - edge) return [99, 102, 241, 255];
  if (dist < r + edge) {
    const alpha = Math.round(255 * (r + edge - dist) / (2 * edge));
    return [99, 102, 241, alpha];
  }

  // Tail (triangle below circle)
  const normY = (y + 0.5 - (cy + r)) / (size * 0.55);
  const normX = Math.abs(x + 0.5 - cx) / (size * 0.18 * (1 - normY * 0.8));
  if (normY >= 0 && normY <= 1 && normX <= 1) {
    const tailEdge = 0.08;
    const inside = Math.min(normX < 1 - tailEdge ? 1 : (1 - normX) / tailEdge, 1);
    const alpha = Math.round(255 * inside);
    return [99, 102, 241, alpha];
  }

  return [0, 0, 0, 0];
}

mkdirSync('./icons', { recursive: true });
for (const size of [16, 48, 128]) {
  writeFileSync(`./icons/${size}.png`, makePng(size, pinPixel));
  console.log(`  icons/${size}.png`);
}
console.log('Icons generated.');
