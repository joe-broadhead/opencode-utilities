import { constants } from "node:fs"
import { lstat, mkdir, open, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fail, fence, UtilitiesError } from "../domain/common.js"
import { identity, privateDirectory, readRegular, type Identity } from "../process/files.js"
import { validateWav } from "./wav.js"

const MAX_SOURCE = 20 * 1024 * 1024, MAX_OUTPUT = 50 * 1024 * 1024

/**
 * Pins the identity of a transcription source before the permission prompt. The file itself may not be a symbolic
 * link; its parent directories may be, as with the host's own file tools.
 */
export async function identifySource(path: string): Promise<Identity> {
  const s = await lstat(path).catch(() => fail("SOURCE_REJECTED"))
  if (!s.isFile() || s.nlink !== 1 || s.size > MAX_SOURCE) fail("SOURCE_REJECTED")
  return identity(s)
}
/** Reads the approved source and checks that it is a WAV the engine takes, failing if it is not the file that was approved. */
export async function readSource(path: string, source: Identity, signal: AbortSignal) {
  // Any change since approval (replaced, relinked, resized, removed) is SOURCE_CHANGED; cancellation stays itself.
  const bytes = await readRegular(path, MAX_SOURCE, signal, source).catch(error => {
    if (error instanceof UtilitiesError && (error.code === "CANCELLED" || error.code === "DEADLINE_EXCEEDED")) throw error
    return fail("SOURCE_CHANGED")
  })
  validateWav(bytes); fence(signal)
  return bytes
}
/** Copies the approved source into the job directory, failing if it is not the file that was approved. */
export async function stageSource(path: string, source: Identity, directory: string, signal: AbortSignal) {
  const bytes = await readSource(path, source, signal)
  const staged = join(directory, "input.wav")
  await writeFile(staged, bytes, { flag: "wx", mode: 0o600 }); fence(signal)
  return staged
}

/** Where a synthesis is saved: the plugin's private default directory, or a path the user approved for `edit`. */
export interface OutputTarget { readonly path: string; readonly owned: boolean }
/** Validates the engine's WAV and saves it with an exclusive create, so an existing file is never replaced. */
export async function saveOutput(engineOutput: string, target: OutputTarget, signal: AbortSignal) {
  const bytes = await readRegular(engineOutput, MAX_OUTPUT, signal), wav = validateWav(bytes, MAX_OUTPUT)
  fence(signal)
  if (target.owned) await privateDirectory(dirname(target.path))
  else await mkdir(dirname(target.path), { recursive: true })
  fence(signal)
  const file = await open(target.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, target.owned ? 0o600 : 0o666)
    .catch(error => { if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("OUTPUT_EXISTS"); throw error })
  try { await file.writeFile(bytes); await file.sync() } finally { await file.close() }
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), durationMs: Math.round(wav.duration * 1000), sampleRateHz: wav.sampleRate, channels: wav.channels }
}
