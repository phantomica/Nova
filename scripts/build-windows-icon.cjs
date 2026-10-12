const fs = require('node:fs/promises')
const path = require('node:path')
const sharp = require('sharp')

const iconDirectory = path.resolve(__dirname, '../resources/icons')
const iconTemplate = path.join(iconDirectory, 'nova-app.svg')
const iconOutput = path.join(iconDirectory, 'nova.ico')
const sizes = [16, 24, 32, 48, 64, 128, 256]

async function main() {
  const svg = (await fs.readFile(iconTemplate, 'utf8'))
    .replaceAll('{{ACCENT_COLOR}}', '#a5ed88')
    .replaceAll('{{BACKGROUND_COLOR}}', '#111311')
  const images = await Promise.all(sizes.map((size) =>
    sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()
  ))
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)

  let imageOffset = header.length + images.length * 16
  const entries = images.map((image, index) => {
    const size = sizes[index]
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size === 256 ? 0 : size, 0)
    entry.writeUInt8(size === 256 ? 0 : size, 1)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(image.length, 8)
    entry.writeUInt32LE(imageOffset, 12)
    imageOffset += image.length
    return entry
  })
  await fs.writeFile(iconOutput, Buffer.concat([header, ...entries, ...images]))
  console.log(`Generated ${iconOutput} with ${sizes.length} PNG sizes.`)
}

main().catch((error) => {
  console.error('Could not generate the Windows application icon:', error)
  process.exitCode = 1
})
