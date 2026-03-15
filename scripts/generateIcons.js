/**
 * Generates simple PNG icon files for the extension.
 * Runs with: node scripts/generateIcons.js
 * No external dependencies — uses only Node.js built-ins (zlib, fs, path).
 */
import { deflateSync } from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(__dirname, '../public/icons')
mkdirSync(outDir, { recursive: true })

// ─── CRC32 ────────────────────────────────────────────────────────────────────
const crcTable = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  crcTable[i] = c
}
function crc32(buf) {
  let crc = 0xffffffff
  for (const b of buf) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// ─── PNG chunk builder ────────────────────────────────────────────────────────
function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.allocUnsafe(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBytes, data])
  const crcBuf = Buffer.allocUnsafe(4)
  crcBuf.writeUInt32BE(crc32(crcInput), 0)
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf])
}

// ─── PNG builder ─────────────────────────────────────────────────────────────
// Draws a solid rounded-ish square icon with a white "N" letter hint.
function buildPNG(size) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR
  const ihdr = Buffer.allocUnsafe(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0

  // Background colour: Twitter blue #1d9bf0
  const BG = [0x1d, 0x9b, 0xf0, 0xff]
  // Accent: white for letter pixels
  const FG = [0xff, 0xff, 0xff, 0xff]

  // Build raw RGBA rows
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.allocUnsafe(1 + size * 4)
    row[0] = 0 // filter None
    for (let x = 0; x < size; x++) {
      // Simple "N" glyph using relative coords (only visible at larger sizes)
      const px = x / size  // 0..1
      const py = y / size  // 0..1
      // Left bar: x in [0.2, 0.35], y in [0.2, 0.8]
      // Right bar: x in [0.65, 0.8], y in [0.2, 0.8]
      // Diagonal: from (0.2,0.2)→(0.8,0.8), width ~0.12
      const leftBar  = px >= 0.20 && px <= 0.35 && py >= 0.20 && py <= 0.80
      const rightBar = px >= 0.65 && px <= 0.80 && py >= 0.20 && py <= 0.80
      const diag = Math.abs((py - 0.20) - (px - 0.20)) < 0.13 &&
                   px >= 0.20 && px <= 0.80 && py >= 0.20 && py <= 0.80
      const isFG = leftBar || rightBar || diag
      const pixel = isFG ? FG : BG
      const offset = 1 + x * 4
      row[offset]     = pixel[0]
      row[offset + 1] = pixel[1]
      row[offset + 2] = pixel[2]
      row[offset + 3] = pixel[3]
    }
    rows.push(row)
  }

  const raw = Buffer.concat(rows)
  const compressed = deflateSync(raw)
  const idat = chunk('IDAT', compressed)
  const iend = chunk('IEND', Buffer.alloc(0))

  return Buffer.concat([sig, chunk('IHDR', ihdr), idat, iend])
}

// ─── Generate ─────────────────────────────────────────────────────────────────
for (const size of [16, 48, 128]) {
  const png = buildPNG(size)
  const outPath = resolve(outDir, `icon${size}.png`)
  writeFileSync(outPath, png)
  console.log(`✓ icon${size}.png  (${png.length} bytes)`)
}
console.log('Icons written to public/icons/')
