import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const width = 512, height = 512
const raw = Buffer.alloc((width * 4 + 1) * height)

const insideRoundedRect = (x, y, radius) => {
  const cx = x < radius ? radius : x >= width - radius ? width - radius - 1 : x
  const cy = y < radius ? radius : y >= height - radius ? height - radius - 1 : y
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

const distanceToSegment = (px, py, x1, y1, x2, y2) => {
  const dx = x2 - x1, dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}

const left = [[112,142],[175,132],[224,151],[256,181],[256,375],[215,345],[165,333],[112,336],[112,142]]
const right = left.map(([x,y]) => [512-x,y])
for (let y = 0; y < height; y++) {
  raw[y * (width * 4 + 1)] = 0
  for (let x = 0; x < width; x++) {
    const offset = y * (width * 4 + 1) + 1 + x * 4
    const background = insideRoundedRect(x, y, 112)
    let ink = false
    for (const points of [left, right]) for (let i = 1; i < points.length; i++) {
      if (distanceToSegment(x, y, ...points[i - 1], ...points[i]) <= 12) ink = true
    }
    const color = ink ? [245,244,241,255] : background ? [41,40,36,255] : [0,0,0,0]
    raw.set(color, offset)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = buffer => {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, crc])
}
const header = Buffer.alloc(13)
header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4)
header[8] = 8; header[9] = 6
const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])

const pngPath = process.argv[2] || 'src-tauri/icons/icon.png'
const icoPath = process.argv[3] || 'src-tauri/icons/icon.ico'
mkdirSync(dirname(pngPath), { recursive: true })
mkdirSync(dirname(icoPath), { recursive: true })
writeFileSync(pngPath, png)

const icoHeader = Buffer.alloc(6)
icoHeader.writeUInt16LE(0, 0)
icoHeader.writeUInt16LE(1, 2)
icoHeader.writeUInt16LE(1, 4)

const directory = Buffer.alloc(16)
directory[0] = 0 // 256px
directory[1] = 0 // 256px
directory[2] = 0
directory[3] = 0
directory.writeUInt16LE(1, 4)
directory.writeUInt16LE(32, 6)
directory.writeUInt32LE(png.length, 8)
directory.writeUInt32LE(icoHeader.length + directory.length, 12)

writeFileSync(icoPath, Buffer.concat([icoHeader, directory, png]))
