// Shared contract for the provider, the handlers and the native packaging: types, constant tables and the routing rule.

/** The plugin's one name (contract §3): plugin id, tool namespace, RPC id and bus prefix. */
export const NAME = "utilities"
/** The Open-Meteo integration that holds the optional commercial API key. */
export const WEATHER_INTEGRATION = "open-meteo"
export const WEATHER_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)"

/**
 * The two session stopgaps. Each names the OpenCode feature whose arrival deletes it; the utilities-sessions skill and
 * the diagnose view state the same sentence. They cover what OpenCode's own session tools do not yet.
 */
export const STOPGAPS = [
  { tool: "utilities_sessions", deletedWhen: "OpenCode gives agents a session list or stats tool with outcome, cost and token fields." },
  { tool: "utilities_sessions_grep", deletedWhen: "OpenCode ships exact-text search over past sessions." },
] as const

export const MODULES = ["weather", "time", "speech"] as const
export type Module = typeof MODULES[number]

/**
 * The 23 methods the runtime runs, by name: the provider's module and operation route a call to its adapter. The
 * remaining methods (status, diagnose, the two session stopgaps and the two installs) are composed by the handlers.
 */
export const TOOLS = {
  time_now: { module: "time", operation: "current_time" },
  time_zones: { module: "time", operation: "list_timezones" },
  time_zone_info: { module: "time", operation: "timezone_info" },
  time_convert: { module: "time", operation: "convert_timezone" },
  time_calendar: { module: "time", operation: "calendar_query" },
  time_add: { module: "time", operation: "date_arithmetic" },
  time_between: { module: "time", operation: "date_diff" },
  time_format: { module: "time", operation: "date_format" },
  time_holidays: { module: "time", operation: "holidays" },
  time_business_days: { module: "time", operation: "business_days" },
  timer_set: { module: "time", operation: "timer_set" },
  timer_get: { module: "time", operation: "timer_get" },
  timer_list: { module: "time", operation: "timer_list" },
  timer_check: { module: "time", operation: "timer_check" },
  timer_delete: { module: "time", operation: "timer_delete" },
  weather_geocode: { module: "weather", operation: "geocode" },
  weather_current: { module: "weather", operation: "current" },
  weather_daily: { module: "weather", operation: "daily" },
  weather_hourly: { module: "weather", operation: "hourly" },
  weather_demand_signal: { module: "weather", operation: "demand_signal" },
  weather_summary: { module: "weather", operation: "summary" },
  speech_transcribe: { module: "speech", operation: "transcribe" },
  speech_synthesize: { module: "speech", operation: "synthesize" },
} as const satisfies Record<string, { readonly module: Module; readonly operation: string }>
export type ModuleTool = keyof typeof TOOLS

// Availability and failures

export const AVAILABILITY = [
  "AVAILABLE", "DISABLED", "CLOSED", "UNSUPPORTED_PLATFORM",
  "NATIVE_FILES_MISSING", "BINARY_MISSING", "INTEGRITY_MISMATCH", "CONTRACT_MISMATCH", "SPEECH_ASSETS_MISSING", "UNSAFE_PATH",
] as const
export type Availability = typeof AVAILABILITY[number]
export type FailureCode = Exclude<Availability, "AVAILABLE">
  | "OPTIONS_INVALID" | "INPUT_INVALID" | "INPUT_LIMIT" | "OUTPUT_LIMIT" | "QUEUE_FULL" | "CANCELLED" | "DEADLINE_EXCEEDED"
  | "SPAWN_FAILED" | "BACKEND_FAILED" | "BACKEND_JSON_INVALID" | "STDOUT_LIMIT" | "STDERR_LIMIT"
  | "TIME_NONEXISTENT" | "TIME_AMBIGUOUS" | "TIME_OFFSET_MISMATCH" | "TIME_OUT_OF_RANGE" | "HOLIDAY_COVERAGE"
  | "TIMER_EXISTS" | "TIMER_NOT_FOUND" | "TIMER_QUOTA" | "TIMER_BYTE_QUOTA" | "TIMER_STATE_UNKNOWN"
  | "WEATHER_KEY_REJECTED"
  | "SOURCE_REJECTED" | "SOURCE_CHANGED" | "WAV_INVALID" | "WAV_UNSUPPORTED" | "AUDIO_DURATION_LIMIT"
  | "SPEECH_FAILED" | "BRIDGE_CORRELATION" | "OUTPUT_EXISTS" | "OUTPUT_PATH_MISMATCH" | "DOWNLOAD_FAILED"
  | "STATE_NOT_PRIVATE" | "STATE_FILE_UNSAFE" | "FILE_REJECTED" | "FILE_CHANGED" | "UNSAFE_CLEANUP" | "CLEANUP_FAILED"
  | "OPERATION_FAILED"
/** What happened (message) and the next step (hint). Messages name zod paths and config keys, never input values. */
export interface UtilitiesFailure { readonly code: FailureCode; readonly message: string; readonly hint?: string }

// Inputs and outputs

/** `path` is relative to the location directory, or absolute. */
export interface TranscriptionInput { readonly path: string; readonly language?: string }
/** Without `path`, the WAV goes to `$XDG_DATA_HOME/opencode-utilities/speech/<project-scope>/<id>.wav`. */
export interface SynthesisInput { readonly text: string; readonly voice?: string; readonly path?: string }
export interface SynthesisOutput {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  readonly durationMs: number
  readonly sampleRateHz: number
  readonly channels: number
  readonly voice: string
}
/** Every weather output is an object that carries the attribution. */
export type WeatherOutput<T extends object> = T & { readonly attribution: typeof WEATHER_ATTRIBUTION }
export type GeocodeOutput<L> = WeatherOutput<{ readonly locations: readonly L[] }>

// Status: the diagnose view. The contract's own status comes from the accounts module's statusAnswer.

/**
 * The plugin's state in the shared machine form. Utilities has no service to connect to, so it is `ready`, unless every
 * enabled module failed, or every module is off.
 */
export const STATES = ["ready", "failed", "disabled"] as const
export type StatusState = typeof STATES[number]

/** The diagnose method's answer: what this machine can do, and why not, with one next step per item that needs one. */
export interface DiagnoseView {
  readonly version: string
  readonly host: { readonly version: string | null; readonly range: string; readonly tested: boolean }
  readonly state: StatusState
  /** What the generated access rules allow, from the plugin options. */
  readonly access: "all" | "ask-changes" | "read-only"
  /** The two session stopgaps and the OpenCode feature each waits on. */
  readonly stopgaps: readonly { readonly tool: string; readonly deletedWhen: string }[]
  readonly nextStep: string
  readonly platform: { readonly target: string; readonly availability: Availability; readonly next?: string }
  readonly modules: { readonly [M in Module]: { readonly availability: Availability; readonly next?: string } }
  readonly weather: {
    readonly tier: "free" | "commercial"
    readonly key: "none" | "connected" | "rejected"
    readonly attribution: typeof WEATHER_ATTRIBUTION
    readonly next?: string
  }
  readonly speech: {
    readonly assets: readonly { readonly role: SpeechAssetRole; readonly name: string; readonly bytes: number; readonly state: "missing" | "cached" | "pre-seeded" }[]
    readonly voices: readonly string[]
    /** speech.assetsDir is set: files are never downloaded. */
    readonly preseeded: boolean
    readonly cacheDirectory: string
    readonly outputDirectory: string
    readonly next?: string
  }
  readonly timers: { readonly due?: number; readonly directory: string; readonly next?: string }
}

// Configuration and runtime

/** Plugin options. Defaults: every module on; stateRoot `$XDG_DATA_HOME/opencode-utilities`. */
export interface Config {
  readonly modules?: { readonly [M in Module]?: boolean }
  readonly stateRoot?: string
  readonly speech?: { readonly assetsDir?: string }
  readonly sessionsDatabasePath?: string
  readonly allowUntestedHost?: boolean
  readonly access?: "all" | "ask-changes" | "read-only"
}
/**
 * From the public `ctx.location`: the project ID, the location directory and the project's directory. As in the
 * host's own file tools, a file under `projectDirectory` is inside the project even when it is outside `directory`.
 */
export interface ProjectLocation { readonly project: string; readonly directory: string; readonly projectDirectory: string }
export interface RuntimeOptions {
  readonly location: ProjectLocation
  readonly modules: { readonly [M in Module]: boolean }
  readonly stateRoot: string
  /** `$XDG_CACHE_HOME/opencode-utilities` by default. */
  readonly cacheRoot: string
  /** Pre-seeded speech assets, verified by hash; nothing is downloaded. */
  readonly speechAssetsDir?: string
  /** A PLATFORMS key; anything else is an unsupported platform. Detected from the process by default. */
  readonly target?: string
  /** The system's glibc version, such as `2.39`, or null without glibc. Detected from the process by default. */
  readonly glibc?: string | null
  /** The Open-Meteo commercial key, if one is connected. */
  readonly weatherKey?: () => Promise<string | undefined>
  /** The installed package root, which holds manifest/. */
  readonly packageRoot?: string
}
/** The StatusView items the runtime fills; the handler fills version, host, weather, access, stopgaps and nextStep. */
export type RuntimeStatus = Pick<DiagnoseView, "platform" | "modules" | "speech" | "timers">
export interface NativeInstallOutput { readonly downloaded: readonly { readonly name: string; readonly bytes: number }[]; readonly bytes: number; readonly cacheDirectory: string }
export interface SpeechInstallOutput { readonly downloaded: readonly { readonly name: string; readonly bytes: number }[]; readonly bytes: number; readonly cacheDirectory: string }
export interface Runtime {
  /** Runs a module tool: parse, availability, queue, then the deadline-bound work. */
  invoke(tool: ModuleTool, input: unknown, signal: AbortSignal): Promise<unknown>
  status(signal?: AbortSignal): Promise<RuntimeStatus>
  /** Downloads every missing speech file. */
  installSpeech(options?: { readonly signal?: AbortSignal }): Promise<SpeechInstallOutput>
  /** Downloads the time and weather programs that are missing. */
  installNatives(options?: { readonly signal?: AbortSignal }): Promise<NativeInstallOutput>
  close(): Promise<void>
}

// Native distribution

/**
 * The platforms with a time and weather build. The one platform table: the native
 * scripts import it too. `triple` is the Rust target; `arch` is what `file` (macOS) or `objdump -f` (Linux) reports
 * for a binary built for it.
 */
export const PLATFORMS = {
  "darwin-arm64": { os: "darwin", cpu: "arm64", triple: "aarch64-apple-darwin", arch: "arm64" },
  "darwin-x64": { os: "darwin", cpu: "x64", triple: "x86_64-apple-darwin", arch: "x86_64" },
  "linux-x64-gnu": { os: "linux", cpu: "x64", libc: "glibc", triple: "x86_64-unknown-linux-gnu", arch: "elf64-x86-64" },
  "linux-arm64-gnu": { os: "linux", cpu: "arm64", libc: "glibc", triple: "aarch64-unknown-linux-gnu", arch: "elf64-littleaarch64" },
} as const
export type Platform = keyof typeof PLATFORMS
/**
 * The oldest glibc each Linux binary runs on. The time and weather programs are built on Ubuntu 22.04 (glibc 2.35) and
 * require nothing newer than GLIBC_2.34, so they run on RHEL 9 and its rebuilds (2.34) too. The speech engine is built
 * on Ubuntu 24.04 (glibc 2.39), because the ONNX Runtime library it links statically needs glibc 2.38 and GCC 13's
 * libstdc++. scripts/native-closure.mjs refuses a release binary above its floor, and the runtime reports
 * UNSUPPORTED_PLATFORM on a system below it.
 */
export const GLIBC_FLOORS = { "time-keep": "2.34", "weather-signal": "2.34", "utilities-speech": "2.39" } as const
export type GlibcBinary = keyof typeof GLIBC_FLOORS
/** The release's native binaries (manifest/native.json), and the tool module each one serves. */
export type NativeBinary = "time-keep" | "weather-signal"
export const NATIVE_OF = { time: "time-keep", weather: "weather-signal" } as const satisfies Readonly<Record<"time" | "weather", NativeBinary>>

export const SPEECH_MODEL_ROLES = ["tiny-q5_1", "kitten-model", "kitten-voices", "kitten-config"] as const
type SpeechModelRole = typeof SPEECH_MODEL_ROLES[number]
export type SpeechAssetRole = "engine" | SpeechModelRole
/** A release file, cached at `<cacheRoot>/<sha256>/<name>`. */
export interface SpeechAsset { readonly name: string; readonly url: string; readonly sha256: string; readonly bytes: number }
/** manifest/speech-assets.json. URLs are `https://github.com/we-the-rebel-alliance/utilities-plugin/releases/download/v<version>/<file>`. */
export interface SpeechAssetManifest {
  readonly engines: { readonly [P in Platform]?: SpeechAsset }
  readonly models: { readonly [R in SpeechModelRole]: SpeechAsset }
}
