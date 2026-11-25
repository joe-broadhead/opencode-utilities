import { createHash, randomUUID } from "node:crypto"
import { lstat, readdir, writeFile } from "node:fs/promises"
import { extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import * as z from "zod"
import { identifySource, readSource, type OutputTarget } from "./artifacts/audio.js"
import { NativeBinaries, belowGlibcFloor, detectGlibc, detectTarget, verifier } from "./backends.js"
import { LIMITS, bounded, deadline, fail, fence, parse, UtilitiesError, abortCode } from "../domain/common.js"
import { AVAILABILITY, NATIVE_OF, SPEECH_MODEL_ROLES, TOOLS, type Availability, type Module, type ModuleTool, type NativeBinary, type NativeInstallOutput, type Runtime, type RuntimeOptions, type RuntimeStatus, type SpeechAssetRole, type SpeechInstallOutput, type SynthesisInput, type TranscriptionInput } from "../domain/contract.js"
import type { ModuleContext } from "./modules/context.js"
import { timeInputs } from "./modules/time/contracts.js"
import { weatherInputs, type WeatherOperation } from "./modules/weather/contracts.js"
import { speechInputs } from "./modules/speech/contracts.js"
import { weatherHosts } from "./modules/weather/argv.js"
import { invoke as invokeSpeech, type EngineOperation, type SpeechJob } from "./modules/speech/adapter.js"
import { invoke as invokeTime } from "./modules/time/adapter.js"
import { invoke as invokeWeather } from "./modules/weather/adapter.js"
import { privateDirectory, removeOwned, resolveRoot, stage, sweep } from "./process/files.js"
import { Queue } from "./process/queue.js"
import { run } from "./process/run.js"
import { fileAccess } from "./files.js"
import { DEFAULT_VOICE, SPEECH_ROLES, SpeechAssets, VOICES, type Entry } from "./speech-assets/index.js"

const INPUTS: { readonly [M in Module]: Readonly<Record<string, z.ZodType>> } = { time: timeInputs, weather: weatherInputs, speech: speechInputs }
const ALL_ROLES: readonly SpeechAssetRole[] = ["engine", ...SPEECH_MODEL_ROLES]
const JOB_AGE = 10 * 60_000, OUTPUT_AGE = 7 * 24 * 60 * 60_000, WEATHER_CACHE_AGE = 31 * 24 * 60 * 60_000
const availability = (error: unknown): Exclude<Availability, "AVAILABLE"> =>
  error instanceof UtilitiesError && (AVAILABILITY as readonly string[]).includes(error.code) ? error.code as Exclude<Availability, "AVAILABLE"> : "CONTRACT_MISMATCH"

const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`
const files = (count: number) => `${count} file${count === 1 ? "" : "s"}`

/** A call that passed availability checks. Nothing has been created yet. */
interface Plan {
  readonly executable?: { readonly path: string; readonly sha256: string }
  readonly env?: Readonly<Record<string, string>>
  readonly commercial?: boolean
  readonly speech?: { readonly roles: readonly SpeechAssetRole[]; readonly source?: SpeechJob["source"]; readonly output?: OutputTarget }
}

export async function createRuntime(given: RuntimeOptions): Promise<Runtime> {
  // Every root is resolved once. Links above them are the user's setup; links inside them are refused (UNSAFE_PATH).
  const [packageRoot, stateRoot, cacheRoot, speechAssetsDir] = await Promise.all([
    resolveRoot(given.packageRoot ?? fileURLToPath(new URL("../../", import.meta.url))), resolveRoot(given.stateRoot), resolveRoot(given.cacheRoot),
    given.speechAssetsDir === undefined ? undefined : resolveRoot(given.speechAssetsDir),
  ])
  const options: RuntimeOptions = { ...given, packageRoot, stateRoot, cacheRoot, ...speechAssetsDir === undefined ? {} : { speechAssetsDir } }
  const target = options.target ?? detectTarget(), directory = resolve(options.location.directory)
  const glibc = options.glibc === undefined ? detectGlibc() : options.glibc
  const location = { directory, projectDirectory: options.location.projectDirectory }
  // Timers and default speech files belong to the project, wherever in it OpenCode runs.
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
  const scope = hash([options.location.project])
  const paths = { store: join(options.stateRoot, "projects", scope, "timers"), jobs: join(options.stateRoot, "jobs"), speech: join(options.stateRoot, "speech"), output: join(options.stateRoot, "speech", scope), weatherCache: join(options.cacheRoot, "weather") }
  const binaries = new NativeBinaries({ packageRoot, cacheRoot: options.cacheRoot, target, glibc })
  const assets = new SpeechAssets({ packageRoot, cacheRoot: options.cacheRoot, target, glibc, ...options.speechAssetsDir === undefined ? {} : { assetsDir: options.speechAssetsDir } })
  const shutdown = new AbortController(), queue = new Queue(), pending = new Set<Promise<unknown>>()
  let closed = false, closing: Promise<void> | undefined

  const track = <T>(work: Promise<T>) => { pending.add(work); void work.finally(() => pending.delete(work)).catch(() => undefined); return work }
  const installHint = (module: NativeBinary) => `Call tools.utilities.native_install to download the ${module} program, then call this tool again.`

  async function plan(tool: ModuleTool, input: unknown): Promise<Plan> {
    const { module, operation } = TOOLS[tool]
    if (module === "time") {
      const executable = await binaries.cached(NATIVE_OF.time)
      if (!executable) fail("NATIVE_FILES_MISSING", { hint: installHint(NATIVE_OF.time) })
      return { executable }
    }
    if (module === "weather") {
      const executable = await binaries.cached(NATIVE_OF.weather)
      if (!executable) fail("NATIVE_FILES_MISSING", { hint: installHint(NATIVE_OF.weather) })
      const key = await options.weatherKey?.(), commercial = key !== undefined
      // XDG_CACHE_HOME outlives the job, so weather-signal's response cache (forecasts 30 minutes, places 30 days) works.
      return { executable, commercial, env: { XDG_CACHE_HOME: paths.weatherCache, ...key === undefined ? {} : { OPEN_METEO_API_KEY: key } } }
    }
    const op = operation as EngineOperation, roles = SPEECH_ROLES[op], entries = await assets.inspect(roles)
    const missing = entries.filter(e => e.state === "missing")
    if (missing.length > 0) {
      assets.requireDownloadable(missing)
      fail("SPEECH_ASSETS_MISSING", { hint: assets.preseeded ? "Copy the missing speech files into speech.assetsDir." : "Call tools.utilities.speech_install to download them, then call this tool again." })
    }
    let source: SpeechJob["source"], output: OutputTarget | undefined
    if (op === "transcribe") {
      // The identity is pinned before the engine runs, so a file swapped in between is refused.
      const file = await fileAccess(location, (input as TranscriptionInput).path)
      const identity = await identifySource(file.absolute).catch(() => undefined)
      source = { path: file.absolute, ...identity ? { identity } : {} }
    } else if (op === "synthesize") {
      const i = input as SynthesisInput
      const file = i.path === undefined ? undefined : await fileAccess(location, i.path)
      if (file && extname(file.absolute).toLowerCase() !== ".wav") fail("INPUT_INVALID", { message: "The tool input is invalid. path: the file name must end with .wav." })
      output = file ? { path: file.absolute, owned: false } : { path: join(paths.output, `${randomUUID()}.wav`), owned: true }
    }
    return { speech: { roles, ...source ? { source } : {}, ...output ? { output } : {} } }
  }

  /** The admitted part of a call. The module deadline starts here. */
  async function perform(tool: ModuleTool, input: unknown, step: Plan, signal: AbortSignal): Promise<unknown> {
    const { module, operation } = TOOLS[tool]
    const release = await queue.acquire(module, signal)
    const limit = deadline(LIMITS.deadline[module]), work = AbortSignal.any([signal, limit.signal])
    let job: string | undefined, mutationStarted = false
    try {
      try {
        // The state root must be private before any child state exists.
        await privateDirectory(options.stateRoot); fence(work)
        let executable = step.executable, speechAssets: Map<SpeechAssetRole, string> | undefined
        if (step.speech) {
          const entries = await assets.inspect(step.speech.roles)
          if (entries.some(e => e.state === "missing")) fail("SPEECH_ASSETS_MISSING")
          speechAssets = new Map(entries.map(e => [e.role, e.path]))
          const engine = entries.find(e => e.role === "engine")!
          executable = { path: engine.path, sha256: engine.asset.sha256 }
        }
        const program = executable!
        job = await stage(paths.jobs, work); fence(work)
        if (module !== "speech") { await writeFile(join(job, "empty.toml"), "", { flag: "wx", mode: 0o600 }); fence(work) }
        // weather-signal keeps its cache in $XDG_CACHE_HOME/weather-signal; the plugin makes the folder private first.
        if (module === "weather") { await privateDirectory(join(paths.weatherCache, "weather-signal")); fence(work) }
        const ctx: ModuleContext = {
          stage: job, store: paths.store, signal: work,
          async run(args, runOptions = {}) {
            // The program is verified again right before each spawn; unchanged files are not re-hashed.
            const checked = await verifier.check(program.path, program.sha256, true)
            if (checked === "unsafe") fail("UNSAFE_PATH")
            if (checked !== "verified") fail("INTEGRITY_MISMATCH")
            fence(work)
            return run({ executable: program.path, args, cwd: job!, signal: work, ...runOptions.stdin === undefined ? {} : { stdin: runOptions.stdin }, ...step.env ? { env: step.env } : {},
              beforeSpawn: () => fence(work), onSpawn: () => { if (runOptions.mutation) mutationStarted = true } })
          },
        }
        let output: unknown
        // Every adapter is part of this bundle. A module only reaches here after its availability checks in plan.
        if (module === "time") output = await invokeTime(operation as never, input as never, ctx)
        else if (module === "weather") output = await invokeWeather(operation as never, input as never, ctx, step.commercial === true)
        else output = await invokeSpeech(operation as EngineOperation, input as never, ctx, { assets: speechAssets!, ...step.speech!.source ? { source: step.speech!.source } : {}, ...step.speech!.output ? { output: step.speech!.output } : {} })
        fence(work); bounded(output, LIMITS.output, "OUTPUT_LIMIT")
        return output
      } catch (error) {
        if (mutationStarted && !(error instanceof UtilitiesError && error.code === "TIMER_NOT_FOUND")) fail("TIMER_STATE_UNKNOWN")
        if (error instanceof UtilitiesError) throw error
        return fail(work.aborted ? abortCode(work) : "OPERATION_FAILED")
      }
    } finally {
      limit.clear()
      try { if (job) await removeOwned(job, paths.jobs) }
      catch { fail(mutationStarted ? "TIMER_STATE_UNKNOWN" : "CLEANUP_FAILED") }
      finally { release() }
    }
  }

  async function execute(tool: ModuleTool, raw: unknown, signal: AbortSignal): Promise<unknown> {
    if (closed) fail("CLOSED")
    const module = TOOLS[tool].module, work = AbortSignal.any([signal, shutdown.signal])
    fence(work)
    if (!options.modules[module]) fail("DISABLED")
    bounded(raw, LIMITS.input, "INPUT_LIMIT")
    const input = parse(INPUTS[module][TOOLS[tool].operation]!, raw, "INPUT_INVALID")
    const step = await plan(tool, input); fence(work)
    return perform(tool, input, step, work)
  }

  async function moduleStatus(module: Module, speech: Promise<Entry[]>): Promise<RuntimeStatus["modules"][Module]> {
    if (!options.modules[module]) return { availability: "DISABLED", next: `Set modules.${module} to true in the Utilities plugin options in opencode.json.` }
    if (closed) return { availability: "CLOSED" }
    try {
      if (module !== "speech") {
        if (await binaries.cached(NATIVE_OF[module]) === undefined) return { availability: "NATIVE_FILES_MISSING", next: "Call tools.utilities.native_install to download the time and weather programs." }
      }
      else if ((await speech).some(e => e.state === "missing")) return { availability: "SPEECH_ASSETS_MISSING", next: assets.preseeded ? "Copy the missing speech files into speech.assetsDir." : "Call tools.utilities.speech_install to download them." }
      return { availability: "AVAILABLE" }
    } catch (error) {
      const code = availability(error)
      // A Linux whose glibc is older than the module's floor says so, with the floor, rather than "no build".
      const below = code === "UNSUPPORTED_PLATFORM" ? belowGlibcFloor(target, glibc, module === "speech" ? "utilities-speech" : NATIVE_OF[module]) : undefined
      const hint = below ? `${module === "speech" ? "The speech engine" : `The ${NATIVE_OF[module]} program`} ${below}.` : new UtilitiesError(code).hint
      return { availability: code, ...hint ? { next: hint } : {} }
    }
  }

  async function dueTimers(signal: AbortSignal): Promise<number | undefined> {
    if (!options.modules.time || closed) return undefined
    try {
      if (!await lstat(paths.store).then(() => true, () => false)) return 0
      const step = await plan("timer_check", { offset: 0, limit: 1 })
      // A background check never downloads a program: without one, there is nothing to check yet.
      if (!step.executable) return undefined
      const output = await perform("timer_check", parse(timeInputs.timer_check, { offset: 0, limit: 1 }), step, signal)
      return (output as { total: number }).total
    } catch { return undefined }
  }

  async function status(signal?: AbortSignal): Promise<RuntimeStatus> {
    const work = signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal
    const platform: RuntimeStatus["platform"] = await binaries.platform().then(
      () => ({ target, availability: "AVAILABLE" as const }),
      error => {
        const code = availability(error)
        const below = belowGlibcFloor(target, glibc, "time-keep")
        const next = code !== "UNSUPPORTED_PLATFORM" ? new UtilitiesError(code).hint : below ? `The time and weather programs ${below.replace(/^needs /, "need ")}.` : `Time and weather tools have no build for ${target}.`
        return { target, availability: code, ...next ? { next } : {} }
      })
    // A disabled module's files are not inspected, so its large files are never hashed.
    const inspected = options.modules.speech ? assets.inspect(ALL_ROLES) : Promise.resolve([])
    inspected.catch(() => undefined)
    const [time, weather, speech] = await Promise.all((["time", "weather", "speech"] as const).map(module => moduleStatus(module, inspected)))
    const entries = await inspected.catch(() => [])
    const missing = entries.filter(e => e.state === "missing"), bytes = missing.reduce((n, e) => n + e.asset.bytes, 0)
    const due = await dueTimers(work)
    return {
      platform, modules: { time: time!, weather: weather!, speech: speech! },
      speech: {
        assets: entries.map(e => ({ role: e.role, name: e.asset.name, bytes: e.asset.bytes, state: e.state })), voices: VOICES, preseeded: assets.preseeded,
        cacheDirectory: options.cacheRoot, outputDirectory: paths.output,
        ...missing.length && options.modules.speech ? { next: assets.preseeded ? "Copy the missing speech files into speech.assetsDir." : `Call tools.utilities.speech_install to download ${files(missing.length)} (${megabytes(bytes)}), or pre-seed speech.assetsDir.` } : {},
      },
      timers: { directory: paths.store, ...due === undefined ? {} : { due }, ...due ? { next: "Call tools.utilities.timer_check to see the due timers." } : {} },
    }
  }

  /** Downloads each missing time or weather program. A cached program is kept. */
  async function installNatives(install: Parameters<Runtime["installNatives"]>[0] = {}): Promise<NativeInstallOutput> {
    if (closed) fail("CLOSED")
    const signal = install.signal ? AbortSignal.any([install.signal, shutdown.signal]) : shutdown.signal
    const downloaded: { name: string; bytes: number }[] = []
    for (const module of ["time-keep", "weather-signal"] as const) {
      if (await binaries.cached(module)) continue
      fence(signal)
      const executable = await binaries.install(module, signal)
      downloaded.push({ name: module, bytes: (await lstat(executable.path)).size })
    }
    return { downloaded, bytes: downloaded.reduce((n, e) => n + e.bytes, 0), cacheDirectory: options.cacheRoot }
  }

  async function installSpeech(install: Parameters<Runtime["installSpeech"]>[0] = {}): Promise<SpeechInstallOutput> {
    if (closed) fail("CLOSED")
    if (!options.modules.speech) fail("DISABLED")
    const signal = install.signal ? AbortSignal.any([install.signal, shutdown.signal]) : shutdown.signal
    const missing = (await assets.inspect(ALL_ROLES)).filter(e => e.state === "missing")
    assets.requireDownloadable(missing)
    fence(signal)
    const downloaded = missing.length ? await assets.download(missing, signal) : []
    return { downloaded: downloaded.map(e => ({ name: e.asset.name, bytes: e.asset.bytes })), bytes: downloaded.reduce((n, e) => n + e.asset.bytes, 0), cacheDirectory: options.cacheRoot }
  }

  /**
   * Best effort: job directories left by a crash, default synthesis files older than 7 days in any project, and
   * weather cache entries past the longest TTL (30 days, for places), which weather-signal never removes itself.
   */
  async function sweepState() {
    await sweep(paths.jobs, /^job-/, JOB_AGE, "directory").catch(() => undefined)
    await sweep(join(paths.weatherCache, "weather-signal"), /^[a-f0-9]{64}\.json(?:\.tmp\.\d+\.\d+)?$/, WEATHER_CACHE_AGE, "file").catch(() => undefined)
    const scopes = await readdir(paths.speech).catch(() => [] as string[])
    for (const name of scopes.filter(name => /^[a-f0-9]{64}$/.test(name))) await sweep(join(paths.speech, name), /^[a-f0-9-]{36}\.wav$/, OUTPUT_AGE, "file").catch(() => undefined)
  }
  await track(sweepState())

  return {
    invoke: (tool, input, signal) => track(execute(tool, input, signal)),
    status: signal => track(status(signal)),
    installSpeech: install => track(installSpeech(install)),
    installNatives: install => track(installNatives(install)),
    close() {
      if (closing) return closing
      closed = true; shutdown.abort()
      closing = Promise.allSettled([...pending]).then(() => undefined)
      return closing
    },
  }
}
