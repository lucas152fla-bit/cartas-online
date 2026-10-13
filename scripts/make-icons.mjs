import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');

const SPADE = [
  '................',
  '.......##.......',
  '......####......',
  '.....######.....',
  '....########....',
  '...##########...',
  '..############..',
  '.##############.',
  '.##############.',
  '################',
  '###..####..###..',
  '.##...##...##...',
  '.......##.......',
  '......####......',
  '.......##.......',
  '................',
];

const BG = [11, 49, 36];
const FG = [231, 193, 74];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function renderPng(size, padding) {
  const rows = [];
  const inner = size - padding * 2;
  const cell = inner / SPADE.length;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x - padding) / cell);
      const sy = Math.floor((y - padding) / cell);
      const on = sx >= 0 && sy >= 0 && sx < 16 && sy < 16 && SPADE[sy][sx] === '#';
      const col = on ? FG : BG;
      const idx = 1 + x * 4;
      row[idx] = col[0]; row[idx + 1] = col[1]; row[idx + 2] = col[2]; row[idx + 3] = 255;
    }
    rows.push(row);
  }
  const idat = deflateSync(Buffer.concat(rows), { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const targets = [
  ['icon-192.png', 192, 22],
  ['icon-512.png', 512, 56],
  ['icon-maskable-512.png', 512, 110],
  ['apple-touch-icon.png', 180, 20],
];
for (const [name, size, padding] of targets) {
  writeFileSync(join(outDir, name), renderPng(size, padding));
  console.log(`${name} (${size}x${size})`);
}
