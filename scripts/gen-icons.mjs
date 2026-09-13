// Generates /public/icons/icon-{180,192,512}.png without external dependencies.
// Draws a simple "plate with curry" glyph on a deep-green background.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function crc32(buf) {
  let c, table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, px) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = deflateSync(raw, { level: 9 });
  const iend = Buffer.alloc(0);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', iend)]);
}

function makeIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const c = size / 100; // scale factor: design in a 100x100 box
  const bg = [20, 83, 45, 255];        // #14532d
  const plate = [250, 247, 240, 255];  // cream
  const curry = [250, 204, 21, 255];   // saffron #facc15
  const leaf = [74, 222, 128, 255];    // green accent
  const ring = [217, 119, 6, 255];     // amber

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const X = x / c, Y = y / c;
      let col = bg;

      // plate: outer circle centered at (50, 52), r=34
      const dOuter = Math.hypot(X - 50, Y - 52);
      // inner bowl r=24 (green, looks like a bowl/leaf)
      const dInner = Math.hypot(X - 50, Y - 54);
      // curry blob: circle at (50, 56) r=11
      const dCurry = Math.hypot(X - 50, Y - 56);
      // rice dots
      const dots = [[40, 48], [58, 46], [46, 40], [62, 58], [36, 60]];
      let isDot = false;
      for (const [dx, dy] of dots) {
        if (Math.hypot(X - dx, Y - dy) < 3.4) { isDot = true; break; }
      }
      // steam wisps above plate
      const steam = [[50, 12], [62, 8], [38, 10]];
      let isSteam = false;
      for (const [sx, sy] of steam) {
        if (Math.hypot(X - sx, Y - sy) < 3.2) { isSteam = true; break; }
      }

      if (isSteam) col = [255, 255, 255, 235];
      else if (isDot) col = [250, 247, 240, 255];
      else if (dCurry < 11) col = curry;
      else if (dInner < 24) col = leaf;
      else if (dOuter < 34 && dOuter > 30) col = ring;
      else if (dOuter < 30) col = plate;

      px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2]; px[i + 3] = col[3];
    }
  }
  return encodePng(size, px);
}

mkdirSync(join(root, 'public', 'icons'), { recursive: true });
for (const size of [180, 192, 512]) {
  const file = join(root, 'public', 'icons', `icon-${size}.png`);
  writeFileSync(file, makeIcon(size));
  console.log('wrote', file, `${size}x${size}`);
}
