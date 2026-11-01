import { fail } from "../domain/common.js"

// PCM integer WAV only. No compressed/container fallback and no ffmpeg. Ancillary chunks (JUNK, LIST, Apple's FLLR,
// bext and others) are skipped, as the speech engine's own decoder does.
export function validateWav(bytes: Buffer, maxBytes = 20 * 1024 * 1024) {
  if (bytes.length < 44 || bytes.length > maxBytes || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE" || bytes.readUInt32LE(4) + 8 !== bytes.length) fail("WAV_INVALID")
  let offset = 12, format: { channels: number; rate: number; block: number; bits: number } | undefined, dataBytes: number | undefined
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail("WAV_INVALID")
    const type = bytes.toString("ascii", offset, offset + 4), size = bytes.readUInt32LE(offset + 4), start = offset + 8
    if (start + size > bytes.length) fail("WAV_INVALID")
    if (type === "fmt ") {
      if (format || size !== 16 || bytes.readUInt16LE(start) !== 1) fail("WAV_UNSUPPORTED")
      const channels = bytes.readUInt16LE(start + 2), rate = bytes.readUInt32LE(start + 4), byteRate = bytes.readUInt32LE(start + 8), block = bytes.readUInt16LE(start + 12), bits = bytes.readUInt16LE(start + 14)
      if (channels < 1 || channels > 2 || rate < 8000 || rate > 48000 || bits !== 16 || block !== channels * bits / 8 || byteRate !== rate * block) fail("WAV_UNSUPPORTED")
      format = { channels, rate, block, bits }
    } else if (type === "data") { if (!format || dataBytes !== undefined || !size) fail("WAV_INVALID"); dataBytes = size }
    offset = start + size + (size % 2)
  }
  if (offset !== bytes.length || !format || dataBytes === undefined || dataBytes % format.block !== 0) fail("WAV_INVALID")
  const duration = dataBytes / format.block / format.rate
  if (duration > 600) fail("AUDIO_DURATION_LIMIT")
  return { sampleRate: format.rate, channels: format.channels, duration }
}
