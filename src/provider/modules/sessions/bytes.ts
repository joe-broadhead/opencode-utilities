// Size caps are counted in BYTES, not characters: a 512-byte snippet of multi-byte text is shorter than 512 characters,
// and cutting at a character index would either split a UTF-8 sequence or exceed the cap.

export const byteLength = (text: string) => Buffer.byteLength(text, "utf8")

/** `text` cut to at most `max` bytes on a UTF-8 boundary, marked with ` …` when anything was cut. */
export function cutBytes(text: string, max: number): string {
  const bytes = Buffer.from(text, "utf8")
  if (bytes.length <= max) return text
  // The mark is four bytes, so the content is cut to leave room for it and the whole stays within `max`.
  let end = Math.max(0, max - 4)
  // `bytes[end]` backs up while it is a continuation byte, so a multi-byte character is never split.
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end--
  return `${bytes.subarray(0, end).toString("utf8").trimEnd()} …`
}
