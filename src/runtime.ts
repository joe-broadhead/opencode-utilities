import { createHash, randomUUID } from "node:crypto"
import { lstat, readdir, writeFile } from "node:fs/promises"
import { dirname, extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type * as z from "zod"
import { identifySource, type OutputTarget } from "./artifacts/audio.js"
import { Backends, detectTarget, packageJson, verifier } from "./domain/backends.js"
import { LIMITS, bounded, deadline, fail, fence, parse, UtilitiesError, abortCode } from "./domain/common.js"
import { AVAILABILITY, SPEECH_MODEL_ROLES, TOOLS, type AdapterResult, type Availability, type Invocation, type Module, type ModuleTool, type PermissionRequest, type PlatformModule, type Runtime, type RuntimeOptions, type RuntimeStatus, type SpeechAssetRole, type SpeechInstallOutput, type SynthesisInput, type TranscriptionInput } from "./domain/contract.js"
import type { ModuleContext } from "./modules/context.js"
import { timeInputs } from "./modules/time/contracts.js"
import { weatherInputs, type WeatherOperation } from "./modules/weather/contracts.js"
import { speechInputs } from "./modules/speech/contracts.js"
import { weatherHosts } from "./modules/weather/argv.js"
import { invoke as invokeSpeech, type EngineOperation, type SpeechJob } from "./modules/speech/adapter.js"
import { invoke as invokeTime } from "./modules/time/adapter.js"
import { invoke as invokeWeather } from "./modules/weather/adapter.js"
import { cleanup } from "./modules/speech/cleanup.js"
import { privateDirectory, removeOwned, resolveRoot, stage, sweep } from "./process/files.js"
import { Queue } from "./process/queue.js"
import { run } from "./process/run.js"
import { fileAccess, readRequests, synthesisRequests, timerRequest, weatherRequest, type WeatherAction } from "./runtime/permissions.js"
import { DEFAULT_VOICE, SPEECH_ROLES, SpeechAssets, VOICES, type Entry } from "./speech-assets/index.js"

const INPUTS: { readonly [M in Module]: Readonly<Record<string, z.ZodType>> } = { time: timeInputs, weather: weatherInputs, speech: speechInputs }
const ALL_ROLES: readonly SpeechAssetRole[] = ["engine", ...SPEECH_MODEL_ROLES]
const JOB_AGE = 10 * 60_000, OUTPUT_AGE = 7 * 24 * 60 * 60_000, WEATHER_CACHE_AGE = 31 * 24 * 60 * 60_000
const availability = (error: unknown): Exclude<Availability, "AVAILABLE"> =>
  error instanceof UtilitiesError && (AVAILABILITY as readonly string[]).includes(error.code) ? error.code as Exclude<Availability, "AVAILABLE"> : "CONTRACT_MISMATCH"
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`
const files = (count: number) => `${count} file${count === 1 ? "" : "s"}`

/** A call that passed availability checks, with the permission requests it needs. Nothing has been created yet. */
interface Plan {
  readonly requests: PermissionRequest[]
  readonly executable?: { readonly path: string; readonly sha256: string }
  readonly env?: Readonly<Record<string, string>>
  readonly commercial?: boolean
  readonly missing?: readonly Entry[]
  readonly speech?: { readonly roles: readonly SpeechAssetRole[]; readonly source?: SpeechJob["source"]; readonly output?: OutputTarget }
}

export async function createRuntime(given: RuntimeOptions): Promise<Runtime> {
  // Every root is resolved once. Links above them are the user's setup; links inside them are refused (UNSAFE_PATH).
  const [packageRoot, stateRoot, cacheRoot, speechAssetsDir] = await Promise.all([
    resolveRoot(given.packageRoot ?? fileURLToPath(new URL("../", import.meta.url))), resolveRoot(given.stateRoot), resolveRoot(given.cacheRoot),
    given.speechAssetsDir === undefined ? undefined : resolveRoot(given.speechAssetsDir),
  ])
  const options: RuntimeOptions = { ...given, packageRoot, stateRoot, cacheRoot, ...speechAssetsDir === undefined ? {} : { speechAssetsDir } }
  const target = options.target ?? detectTarget(), directory = resolve(options.location.directory)
  const location = { directory, projectDirectory: options.location.projectDirectory }
  // Timers and default speech files belong to the project, wherever in it OpenCode runs.
  const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
  const scope = hash([options.location.project]), store = (key: string) => join(options.stateRoot, "projects", key, "timers")
  const paths = { store: store(scope), jobs: join(options.stateRoot, "jobs"), speech: join(options.stateRoot, "speech"), output: join(options.stateRoot, "speech", scope), weatherCache: join(options.cacheRoot, "weather") }
  // 0.0.1 kept a store per location directory, keyed by [project, directory]. Those of this directory and its parents
  // are moved into the project store on first use; another folder's moves when OpenCode runs there.
  const legacy: string[] = []
  for (let dir = directory; ; dir = dirname(dir)) { legacy.push(store(hash([options.location.project, dir]))); if (dirname(dir) === dir) break }
  const backends = new Backends(packageRoot, target)
  const assets = new SpeechAssets({ packageRoot, cacheRoot: options.cacheRoot, target, ...options.speechAssetsDir === undefined ? {} : { assetsDir: options.speechAssetsDir } })
  const shutdown = new AbortController(), queue = new Queue(), pending = new Set<Promise<unknown>>(), listeners = new Set<() => void>()
  let closed = false, closing: Promise<void> | undefined

  const packageVersion = packageJson(join(packageRoot, "package.json")).then(v => (v as { version?: unknown }).version, () => undefined)
  const track = <T>(work: Promise<T>) => { pending.add(work); void work.finally(() => pending.delete(work)).catch(() => undefined); return work }
  const changed = () => { for (const listener of listeners) { try { listener() } catch { /* A listener's failure is its own. */ } } }

  async function plan(tool: ModuleTool, input: unknown): Promise<Plan> {
    const { module, operation } = TOOLS[tool]
    if (module === "time") {
      const executable = await backends.executable("time")
      const write = tool === "timer_set" || tool === "timer_delete" ? [timerRequest(`utilities_${tool}`, (input as { name: string }).name)] : []
      return { executable, requests: write }
    }
    if (module === "weather") {
      const executable = await backends.executable("weather"), key = await options.weatherKey?.(), commercial = key !== undefined
      const i = input as { location?: string; query?: string }
      const request = weatherRequest(`utilities_${tool}` as WeatherAction, weatherHosts(operation as WeatherOperation, commercial), i.location ?? i.query ?? "")
      // XDG_CACHE_HOME outlives the job, so weather-signal's response cache (forecasts 30 minutes, places 30 days) works.
      return { executable, commercial, env: { XDG_CACHE_HOME: paths.weatherCache, ...key === undefined ? {} : { OPEN_METEO_API_KEY: key } }, requests: [request] }
    }
    const op = operation as EngineOperation, roles = SPEECH_ROLES[op], entries = await assets.inspect(roles)
    const missing = entries.filter(e => e.state === "missing")
    assets.requireDownloadable(missing)
    let requests: PermissionRequest[] = [], source: SpeechJob["source"], output: OutputTarget | undefined
    if (op === "transcribe") {
      // The identity is pinned before the prompt, so a file swapped while waiting is refused. A file that cannot be
      // identified fails only after approval, so a call cannot probe for files without a prompt.
      const file = await fileAccess(location, (input as TranscriptionInput).path)
      const identity = await identifySource(file.absolute).catch(() => undefined)
      source = { path: file.absolute, ...identity ? { identity } : {} }
      requests = readRequests(file)
    } else if (op === "synthesize") {
      const i = input as SynthesisInput
      const file = i.path === undefined ? undefined : await fileAccess(location, i.path)
      if (file && extname(file.absolute).toLowerCase() !== ".wav") fail("INPUT_INVALID", { message: "The tool input is invalid. path: the file name must end with .wav." })
      output = file ? { path: file.absolute, owned: false } : { path: join(paths.output, `${randomUUID()}.wav`), owned: true }
      requests = synthesisRequests(i.voice ?? DEFAULT_VOICE, i.text.length, file)
    }
    if (missing.length) requests.push(assets.request(missing))
    return { requests, missing, speech: { roles, ...source ? { source } : {}, ...output ? { output } : {} } }
  }

  /** The admitted, approved part of a call. The module deadline starts here. */
  async function perform(tool: ModuleTool, input: unknown, step: Plan, signal: AbortSignal): Promise<AdapterResult> {
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
          stage: job, store: paths.store, legacyStores: legacy, signal: work,
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
        let result: AdapterResult
        // Every adapter is part of this bundle. A module only reaches here after its availability checks in execute and plan.
        if (module === "time") result = await invokeTime(operation as never, input as never, ctx)
        else if (module === "weather") result = await invokeWeather(operation as never, input as never, ctx, step.commercial === true)
        else result = await invokeSpeech(operation as EngineOperation, input as never, ctx, { assets: speechAssets!, ...step.speech!.source ? { source: step.speech!.source } : {}, ...step.speech!.output ? { output: step.speech!.output } : {} })
        fence(work); bounded(result.output, LIMITS.output, "OUTPUT_LIMIT")
        return result
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

  async function execute(tool: ModuleTool, raw: unknown, invocation: Invocation): Promise<AdapterResult> {
    if (closed) fail("CLOSED")
    const module = TOOLS[tool].module, signal = AbortSignal.any([invocation.signal, shutdown.signal])
    fence(signal)
    if (!options.modules[module]) fail("DISABLED")
    bounded(raw, LIMITS.input, "INPUT_LIMIT")
    const input = parse(INPUTS[module][TOOLS[tool].operation]!, raw, "INPUT_INVALID")
    // Cleanup is plain string rules: no engine, no download, no queue and nothing to ask.
    if (tool === "speech_cleanup") {
      const { text, style } = input as z.output<typeof speechInputs.cleanup>, output = cleanup(text, style)
      bounded(output, LIMITS.output, "OUTPUT_LIMIT")
      return { output, text: output.text }
    }
    const step = await plan(tool, input); fence(signal)
    // Permission errors propagate unchanged: no catch wraps this await.
    if (step.requests.length) await options.authorize(step.requests, { ...invocation, signal })
    fence(signal)
    if (step.missing?.length) { await assets.download(step.missing, signal); changed() }
    return perform(tool, input, step, signal)
  }

  async function moduleStatus(module: Module, speech: Promise<Entry[]>): Promise<RuntimeStatus["modules"][Module]> {
    if (!options.modules[module]) return { availability: "DISABLED", next: `Set modules.${module} to true in the utilities.tools plugin options.` }
    if (closed) return { availability: "CLOSED" }
    try {
      if (module !== "speech") await backends.executable(module as PlatformModule)
      else if ((await speech).some(e => e.state === "missing")) return { availability: "SPEECH_ASSETS_MISSING", next: assets.preseeded ? "Copy the missing speech files into speech.assetsDir." : "Run /utilities-speech-install, or approve the download on the first speech call." }
      return { availability: "AVAILABLE" }
    } catch (error) {
      const code = availability(error), hint = new UtilitiesError(code).hint
      return { availability: code, ...hint ? { next: hint } : {} }
    }
  }

  async function dueTimers(signal: AbortSignal): Promise<number | undefined> {
    if (!options.modules.time || closed) return undefined
    try {
      const exists = (path: string) => lstat(path).then(() => true, () => false)
      if (!(await Promise.all([paths.store, ...legacy].map(exists))).includes(true)) return 0
      const step = await plan("timer_check", { offset: 0, limit: 1 })
      const { output } = await perform("timer_check", parse(timeInputs.timer_check, { offset: 0, limit: 1 }), step, signal)
      return (output as { total: number }).total
    } catch { return undefined }
  }

  async function status(signal?: AbortSignal): Promise<RuntimeStatus> {
    const work = signal ? AbortSignal.any([signal, shutdown.signal]) : shutdown.signal
    const version = await packageVersion, name = backends.package
    const platform: RuntimeStatus["platform"] = await backends.platform().then(
      () => ({ target, ...name ? { package: name } : {}, availability: "AVAILABLE" as const }),
      error => {
        const code = availability(error)
        const next = code === "PLATFORM_PACKAGE_MISSING" ? `Reinstall the plugin so npm installs ${name}${typeof version === "string" ? `@${version}` : ""}, then restart OpenCode.`
          : code === "UNSUPPORTED_PLATFORM" ? `Time and weather tools have no build for ${target}.` : new UtilitiesError(code).hint
        return { target, ...name ? { package: name } : {}, availability: code, ...next ? { next } : {} }
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
        ...missing.length && options.modules.speech ? { next: assets.preseeded ? "Copy the missing speech files into speech.assetsDir." : `Run /utilities-speech-install to download ${files(missing.length)} (${megabytes(bytes)}), or pre-seed speech.assetsDir.` } : {},
      },
      timers: { directory: paths.store, ...due === undefined ? {} : { due }, ...due ? { next: "Call utilities_timer_check to see the due timers." } : {} },
    }
  }

  async function installSpeech(install: Parameters<Runtime["installSpeech"]>[0] = {}): Promise<AdapterResult<SpeechInstallOutput>> {
    if (closed) fail("CLOSED")
    if (!options.modules.speech) fail("DISABLED")
    const signal = install.signal ? AbortSignal.any([install.signal, shutdown.signal]) : shutdown.signal
    const missing = (await assets.inspect(ALL_ROLES)).filter(e => e.state === "missing")
    assets.requireDownloadable(missing)
    if (missing.length && install.authorize) await install.authorize([assets.request(missing)])
    fence(signal)
    const downloaded = missing.length ? await assets.download(missing, signal) : []
    if (downloaded.length) changed()
    const bytes = downloaded.reduce((n, e) => n + e.asset.bytes, 0)
    const output = { downloaded: downloaded.map(e => ({ name: e.asset.name, bytes: e.asset.bytes })), bytes, cacheDirectory: options.cacheRoot }
    return { output, text: downloaded.length ? `Downloaded ${files(downloaded.length)} (${megabytes(bytes)}) into the speech cache. Speech tools are ready.` : "All speech files are already installed. Speech tools are ready." }
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
    invoke: (tool, input, invocation) => track(execute(tool, input, invocation)),
    status: signal => track(status(signal)),
    installSpeech: install => track(installSpeech(install)),
    onAvailabilityChange(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    close() {
      if (closing) return closing
      closed = true; shutdown.abort(); listeners.clear()
      closing = Promise.allSettled([...pending]).then(() => undefined)
      return closing
    },
  }
}
