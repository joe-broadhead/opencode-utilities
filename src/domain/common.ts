import * as z from "zod"
import type { FailureCode, UtilitiesFailure } from "./contract.js"

/** Per-module bounds. Each module has its own queue; the deadline starts after admission and approval. */
export const LIMITS = {
  input: 32768, stdout: 1048576, stderr: 65536, output: 65536, timers: 1000,
  concurrency: { time: 4, weather: 2, speech: 1 },
  queued: { time: 32, weather: 16, speech: 4 },
  deadline: { time: 10000, weather: 45000, speech: 120000 },
} as const
export const text = (max = 256) => z.string().max(max).refine(s => !s.includes("\0"))
export const byteText = (max: number) => text(max).refine(s => new TextEncoder().encode(s).length <= max)
export const integer = z.number().int().safe()
export const finite = z.number().finite()
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T00:00:00Z`); return Number.isFinite(+d) && d.toISOString().slice(0, 10) === s && s >= "1900-01-01" && s <= "2100-12-31"
})
export const datetime = z.string().max(80).regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?$/).refine(s => date.safeParse(s.slice(0, 10)).success && Number(s.slice(11, 13)) < 24 && Number(s.slice(14, 16)) < 60)
export const instant = datetime.refine(s => /(?:Z|[+-]\d{2}:\d{2})$/.test(s) && Number.isFinite(Date.parse(s)))
export const dateOrTime = z.union([date, datetime])
export const zone = z.string().max(80).regex(/^(?:UTC|[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+)$/).refine(s => {
  try { new Intl.DateTimeFormat("en", { timeZone: s }); return true } catch { return false }
})
export const empty = z.strictObject({})

/** What happened and the user's next step, per code. Messages never contain private input values. */
export const FAILURES: { readonly [C in FailureCode]: readonly [message: string, hint?: string] } = {
  DISABLED: ["This module is turned off in the plugin options.", "Set modules.<name> to true in the utilities.tools plugin options."],
  CLOSED: ["The Utilities plugin is shutting down.", "Retry after OpenCode has reloaded the plugin."],
  HOST_UNTESTED: ["This OpenCode version is not a tested host for the Utilities plugin.", "Use OpenCode 2.2.x, or set allowUntestedHost: true in the plugin options."],
  UNSUPPORTED_PLATFORM: ["This module has no build for this platform.", "Call utilities_status to see which modules work here."],
  PLATFORM_PACKAGE_MISSING: ["The platform package with the time and weather programs is not installed.", "Reinstall the plugin so npm installs its platform package, then restart OpenCode."],
  BINARY_MISSING: ["A program the plugin needs is missing from its platform package.", "Reinstall the plugin, then restart OpenCode."],
  INTEGRITY_MISMATCH: ["A program or model file does not match its pinned SHA-256 hash.", "Reinstall the plugin, then restart OpenCode."],
  CONTRACT_MISMATCH: ["The plugin's files, or a program's output, do not match what this plugin version expects.", "Reinstall the plugin. If it persists, report it with the utilities_status output."],
  SPEECH_ASSETS_MISSING: ["The speech engine or model files are not installed.", "Approve the utilities_speech_download request, run /utilities-speech-install, or pre-seed the files in speech.assetsDir."],
  OPTIONS_INVALID: ["The plugin options are invalid.", "Fix the named option in the utilities.tools plugin options."],
  STATUS_UNAVAILABLE: ["Utilities status could not be read.", "Run /utilities-status in a session to see the error, or check the OpenCode server log."],
  SKILLS_INVALID: ["A Utilities skill file is missing or malformed, so that skill was skipped.", "Reinstall the plugin."],
  INPUT_INVALID: ["The tool input is invalid.", "Correct the named fields and call the tool again."],
  INPUT_LIMIT: ["The tool input is too large.", "Send less text and call the tool again."],
  OUTPUT_LIMIT: ["The result is too large to return.", "Narrow the request, for example fewer days, hours or results."],
  QUEUE_FULL: ["Too many calls to this module are waiting.", "Wait for earlier calls to finish, then retry."],
  CANCELLED: ["The call was cancelled.", "Call the tool again if you still need the result."],
  DEADLINE_EXCEEDED: ["The call took longer than its time limit.", "Retry, or narrow the request."],
  SPAWN_FAILED: ["The plugin could not start the program behind this tool.", "Call utilities_status, and reinstall the plugin if a module is unavailable."],
  BACKEND_FAILED: ["The program behind this tool reported an error.", "Check the input and retry."],
  BACKEND_JSON_INVALID: ["The program behind this tool returned unreadable output.", "Retry. If it persists, reinstall the plugin."],
  STDOUT_LIMIT: ["The program behind this tool returned more output than the plugin accepts.", "Narrow the request."],
  STDERR_LIMIT: ["The program behind this tool wrote too much diagnostic output.", "Retry. If it persists, reinstall the plugin."],
  TIMER_EXISTS: ["A timer with that name already exists.", "Call utilities_timer_set with replace: true to overwrite it."],
  TIMER_NOT_FOUND: ["No timer with that name exists in this project.", "Call utilities_timer_list to see this project's timers."],
  TIMER_QUOTA: ["This project already has 1000 timers.", "Delete timers with utilities_timer_delete first."],
  TIMER_BYTE_QUOTA: ["This project's timer store is full.", "Delete timers, or use shorter descriptions and tags."],
  TIMER_STATE_UNKNOWN: ["The timer change may or may not have been saved.", "Call utilities_timer_get or utilities_timer_list before you retry."],
  WEATHER_KEY_REJECTED: ["Open-Meteo rejected the connected API key.", "Run /connect and choose Open-Meteo, then enter a valid key, or run opencode auth logout open-meteo to use the free tier."],
  SOURCE_REJECTED: ["The audio file cannot be used. It must be an existing regular file of at most 20 MiB, not a symbolic link.", "Pass the path of a 16-bit PCM WAV file."],
  SOURCE_CHANGED: ["The audio file changed while the call was waiting.", "Call the tool again."],
  WAV_INVALID: ["The file is not a valid WAV file.", "Convert it to 16-bit PCM WAV, for example with `ffmpeg -i input.m4a -ac 1 -ar 16000 -c:a pcm_s16le output.wav`, then call the tool again."],
  WAV_UNSUPPORTED: ["Only 16-bit PCM WAV at 8-48 kHz, mono or stereo, is supported.", "Convert it to 16-bit PCM WAV, for example with `ffmpeg -i input.m4a -ac 1 -ar 16000 -c:a pcm_s16le output.wav`, then call the tool again."],
  AUDIO_DURATION_LIMIT: ["The audio is longer than ten minutes.", "Split it into shorter files."],
  SPEECH_FAILED: ["The speech engine failed.", "Retry. If it persists, call utilities_status."],
  BRIDGE_CORRELATION: ["The speech engine answered a different request.", "Retry. If it persists, delete the speech cache and run /utilities-speech-install."],
  OUTPUT_EXISTS: ["A file already exists at the output path.", "Choose another path, or delete the file first."],
  OUTPUT_PATH_MISMATCH: ["The speech engine wrote its output somewhere unexpected.", "Retry. If it persists, delete the speech cache and run /utilities-speech-install."],
  DOWNLOAD_FAILED: ["Downloading the speech files failed.", "Check the network and proxy settings and retry, or pre-seed the files in speech.assetsDir."],
  UNSAFE_PATH: ["A file or folder inside the plugin's own directories (stateRoot, the speech cache, speech.assetsDir or the installed package) is a symbolic link, or not the expected type. Links above those directories are fine.", "Replace the link with the real file or folder, or reinstall the plugin."],
  STATE_NOT_PRIVATE: ["The plugin's state directory is accessible to other users.", "Run chmod 700 on the stateRoot directory."],
  STATE_FILE_UNSAFE: ["A timer store file is a link or not a regular file.", "Remove the unexpected file from this project's timer directory."],
  FILE_REJECTED: ["A file the plugin reads is not a regular file, or is too large.", "Reinstall the plugin."],
  FILE_CHANGED: ["A file changed while the plugin was reading it.", "Retry."],
  UNSAFE_CLEANUP: ["The plugin refused to delete a path outside its own directories.", "Report this with the utilities_status output."],
  CLEANUP_FAILED: ["The plugin could not remove its temporary files.", "Retry. Leftover job directories are removed the next time the plugin starts."],
  OPERATION_FAILED: ["The tool failed unexpectedly.", "Retry. If it persists, call utilities_status."],
}

/** The one error text: `CODE: what happened. Next step: What to do.` */
export const formatFailure = (failure: UtilitiesFailure) => `${failure.code}: ${failure.message}${failure.hint ? ` Next step: ${failure.hint}` : ""}`

export class UtilitiesError extends Error implements UtilitiesFailure {
  readonly hint?: string
  constructor(readonly code: FailureCode, detail: { message?: string; hint?: string } = {}) {
    const [message, hint] = FAILURES[code]
    super(detail.message ?? message)
    this.name = "UtilitiesError"
    const next = detail.hint ?? hint
    if (next !== undefined) this.hint = next
  }
}
export function fail(code: FailureCode, detail?: { message?: string; hint?: string }): never { throw new UtilitiesError(code, detail) }

/** Parses with the schema. INPUT_INVALID names the zod paths and rules, never the values. */
export function parse<T extends z.ZodType>(schema: T, input: unknown, code: FailureCode = "CONTRACT_MISMATCH"): z.output<T> {
  const parsed = schema.safeParse(input)
  if (parsed.success) return parsed.data
  if (code !== "INPUT_INVALID") fail(code)
  const issues = parsed.error.issues.slice(0, 8).map(issue => `${issue.path.length ? issue.path.join(".") : "input"}: ${issue.message}`)
  return fail(code, { message: `The tool input is invalid. ${issues.join("; ")}.` })
}
export function bounded(value: unknown, max: number, code: FailureCode) {
  let size: number
  try { size = Buffer.byteLength(JSON.stringify(value)) } catch { return fail(code) }
  if (size > max) fail(code)
}

/** The abort reason a module deadline uses, so DEADLINE_EXCEEDED is reported apart from CANCELLED. */
const DEADLINE = new Error("DEADLINE_EXCEEDED")
export const abortCode = (signal: AbortSignal) => signal.reason === DEADLINE ? "DEADLINE_EXCEEDED" as const : "CANCELLED" as const
export function fence(signal: AbortSignal) { if (signal.aborted) fail(abortCode(signal)) }
export function deadline(ms: number) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(DEADLINE), ms)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}
