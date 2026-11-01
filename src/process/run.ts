import { spawn } from "node:child_process"
import { join } from "node:path"
import { LIMITS, abortCode, fail, fence, UtilitiesError } from "../domain/common.js"

/** A scrubbed child environment rooted in the job directory. `extra` carries secrets that must never go in argv. */
function environment(root: string, extra: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  return { HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_CACHE_HOME: join(root, "cache"), XDG_DATA_HOME: join(root, "data"), TMPDIR: root, LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TZ: "UTC", TIME_KEEP_TZ: "UTC", RUST_LOG: "off", PATH: "", ...extra }
}
/** A nonzero exit. `report` is the program's JSON error from stderr, if any; it may hold private input, so never show it. */
export class BackendFailure extends UtilitiesError {
  constructor(readonly report: unknown) { super("BACKEND_FAILED") }
}
interface RunRequest {
  executable: string; args: readonly string[]; cwd: string; signal: AbortSignal
  stdin?: string; env?: Readonly<Record<string, string>>; beforeSpawn?: () => void; onSpawn?: () => void
}
export async function run(request: RunRequest): Promise<unknown> {
  fence(request.signal)
  if (request.stdin && Buffer.byteLength(request.stdin) > LIMITS.input) fail("INPUT_LIMIT")
  return new Promise((resolve, reject) => {
    fence(request.signal); request.beforeSpawn?.()
    const child = spawn(request.executable, request.args, { cwd: request.cwd, env: environment(request.cwd, request.env), shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] })
    let error: UtilitiesError | undefined, bytes = 0, stderrBytes = 0, finished = false
    const chunks: Buffer[] = [], stderr: Buffer[] = []
    let escalation: ReturnType<typeof setTimeout> | undefined
    const kill = (signal: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, signal) } catch { try { child.kill(signal) } catch {} } }
    const stop = (code: UtilitiesError["code"]) => { if (finished || error) return; error = new UtilitiesError(code); child.stdin.destroy(); kill("SIGTERM"); escalation = setTimeout(() => kill("SIGKILL"), 100) }
    const abort = () => stop(abortCode(request.signal))
    request.signal.addEventListener("abort", abort, { once: true })
    child.once("spawn", () => { request.onSpawn?.(); if (request.signal.aborted) abort() })
    child.stdout.on("data", (data: Buffer) => { bytes += data.length; if (bytes > LIMITS.stdout) stop("STDOUT_LIMIT"); else if (!error) chunks.push(data) })
    child.stderr.on("data", (data: Buffer) => { stderrBytes += data.length; if (stderrBytes > LIMITS.stderr) stop("STDERR_LIMIT"); else stderr.push(data) })
    child.stdin.on("error", () => { /* Broken pipe is handled by exit status. */ })
    child.once("error", () => { error ??= new UtilitiesError("SPAWN_FAILED") })
    child.once("close", code => {
      finished = true; if (escalation) clearTimeout(escalation); request.signal.removeEventListener("abort", abort)
      // Descendants belong to this invocation, even if the main process exited successfully.
      kill("SIGKILL")
      if (error) return reject(error)
      if (request.signal.aborted) return reject(new UtilitiesError(abortCode(request.signal)))
      if (code !== 0) return reject(new BackendFailure(json(stderr)))
      try { resolve(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))) }
      catch { reject(new UtilitiesError("BACKEND_JSON_INVALID")) }
    })
    child.stdin.end(request.stdin ?? "")
    if (request.signal.aborted) abort()
  })
}
function json(chunks: Buffer[]): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))) } catch { return undefined }
}
