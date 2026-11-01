import { constants } from "node:fs"
import { open, rename, rm } from "node:fs/promises"
import { createHash, randomUUID } from "node:crypto"
import { dirname, join } from "node:path"
import { abortCode, fail, fence, UtilitiesError } from "../domain/common.js"
import type { SpeechAsset } from "../domain/contract.js"

/** No bytes for this long aborts a download. */
const STALL = 60_000

/**
 * Downloads one asset to `target`. Bytes go to a private temporary file in the same directory, never above the
 * pinned size; only a file with the pinned size and SHA-256 gets its final mode and is renamed into place, so a
 * partial or tampered download can never be executed. `fetch` applies the service's proxy environment.
 */
export async function download(asset: SpeechAsset, target: string, mode: number, signal: AbortSignal) {
  fence(signal)
  const temp = join(dirname(target), `.download-${randomUUID()}`)
  const stall = new AbortController(), request = AbortSignal.any([signal, stall.signal])
  let watchdog = setTimeout(() => stall.abort(), STALL)
  const handle = await open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  let renamed = false
  try {
    const response = await fetch(asset.url, { signal: request, redirect: "follow" })
    if (!response.ok || !response.body) fail("DOWNLOAD_FAILED", { message: `Downloading ${asset.name} failed with HTTP status ${response.status}.` })
    const length = response.headers.get("content-length")
    if (length !== null && Number(length) !== asset.bytes) wrongSize(asset)
    const hash = createHash("sha256")
    let received = 0
    for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
      clearTimeout(watchdog); watchdog = setTimeout(() => stall.abort(), STALL)
      received += chunk.byteLength
      if (received > asset.bytes) wrongSize(asset)
      hash.update(chunk); await handle.write(chunk)
    }
    if (received !== asset.bytes) wrongSize(asset)
    if (hash.digest("hex") !== asset.sha256) fail("INTEGRITY_MISMATCH", { message: `The downloaded ${asset.name} does not match its pinned SHA-256 hash, so it was discarded.`, hint: "Retry. If it persists, the release files may have been changed; report it." })
    await handle.sync(); await handle.chmod(mode); await handle.close()
    fence(signal)
    await rename(temp, target); renamed = true
  } catch (error) {
    if (error instanceof UtilitiesError) throw error
    if (signal.aborted) fail(abortCode(signal))
    fail("DOWNLOAD_FAILED", { message: stall.signal.aborted ? `Downloading ${asset.name} stalled with no data for ${STALL / 1000} s.` : `Downloading ${asset.name} was interrupted.` })
  } finally {
    clearTimeout(watchdog)
    await handle.close().catch(() => undefined)
    if (!renamed) await rm(temp, { force: true })
  }
}
function wrongSize(asset: SpeechAsset): never {
  return fail("DOWNLOAD_FAILED", { message: `The download of ${asset.name} has the wrong size (expected ${asset.bytes} bytes), so it was discarded.`, hint: "Retry. If it persists, check that no proxy rewrites downloads, or pre-seed the files in speech.assetsDir." })
}
