// Shared contract for runtime, host, RPC, TUI and native packaging: types, constant tables and the registration rule.

export const PLUGIN_ID = "utilities.local"
export const TUI_ID = "utilities.local.tui"
export const NAMESPACE = "utilities"
export const COMMANDS = { status: "utilities-status", speechInstall: "utilities-speech-install" } as const
export const WEATHER_INTEGRATION = "open-meteo"
export const WEATHER_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)"

export const MODULES = ["weather", "time", "speech"] as const
export type Module = typeof MODULES[number]

/** What a call does. compute and read-state assert nothing; the other classes decide the permission requests. */
const EFFECTS = ["compute", "read-state", "write-state", "network", "read-file", "write-file"] as const
export type Effect = typeof EFFECTS[number]

/** The 24 tools, registered in NAMESPACE as `utilities_<name>`. `module` and `operation` route a call to its adapter. */
export const TOOLS = {
  status: { effect: "compute" },
  time_now: { effect: "compute", module: "time", operation: "current_time" },
  time_zones: { effect: "compute", module: "time", operation: "list_timezones" },
  time_zone_info: { effect: "compute", module: "time", operation: "timezone_info" },
  time_convert: { effect: "compute", module: "time", operation: "convert_timezone" },
  time_calendar: { effect: "compute", module: "time", operation: "calendar_query" },
  time_add: { effect: "compute", module: "time", operation: "date_arithmetic" },
  time_between: { effect: "compute", module: "time", operation: "date_diff" },
  time_format: { effect: "compute", module: "time", operation: "date_format" },
  time_holidays: { effect: "compute", module: "time", operation: "holidays" },
  time_business_days: { effect: "compute", module: "time", operation: "business_days" },
  timer_set: { effect: "write-state", module: "time", operation: "timer_set" },
  timer_get: { effect: "read-state", module: "time", operation: "timer_get" },
  timer_list: { effect: "read-state", module: "time", operation: "timer_list" },
  timer_check: { effect: "read-state", module: "time", operation: "timer_check" },
  timer_delete: { effect: "write-state", module: "time", operation: "timer_delete" },
  weather_geocode: { effect: "network", module: "weather", operation: "geocode" },
  weather_current: { effect: "network", module: "weather", operation: "current" },
  weather_daily: { effect: "network", module: "weather", operation: "daily" },
  weather_hourly: { effect: "network", module: "weather", operation: "hourly" },
  weather_demand_signal: { effect: "network", module: "weather", operation: "demand_signal" },
  weather_summary: { effect: "network", module: "weather", operation: "summary" },
  speech_transcribe: { effect: "read-file", module: "speech", operation: "transcribe" },
  speech_synthesize: { effect: "write-file", module: "speech", operation: "synthesize" },
} as const satisfies Record<string, { readonly effect: Effect; readonly module?: Module; readonly operation?: string }>
export type ToolName = keyof typeof TOOLS
export type EffectiveToolName = `${typeof NAMESPACE}_${ToolName}`

/** What a tool can do, for the tools RPC's describe and a job's approval: the worst thing its call does. */
export type MethodClass = "read" | "write" | "export"
export function methodClass(name: ToolName): MethodClass {
  const effect = TOOLS[name].effect
  if (effect === "write-state") return "write"
  if (effect === "write-file") return "export"
  return "read"
}

// Permissions

export const SPEECH_DOWNLOAD_ACTION = "utilities_speech_download"
/** Inserted as `{ action, resource: "*", effect: "ask" }` directly after each agent's base `* * allow` rule. */
export const DEFAULT_ASK = ["utilities_weather_*", "utilities_timer_set", "utilities_timer_delete", "utilities_speech_synthesize", SPEECH_DOWNLOAD_ACTION] as const
type DefaultAskAction = typeof DEFAULT_ASK[number]

type AssertedTool = { [K in ToolName]: typeof TOOLS[K]["effect"] extends "write-state" | "network" | "write-file" ? K : never }[ToolName]
/** Tool actions for write-state, network and write-file calls; host `read`, `edit` and `external_directory` for file paths. */
type PermissionAction = `${typeof NAMESPACE}_${AssertedTool}` | typeof SPEECH_DOWNLOAD_ACTION | "read" | "edit" | "external_directory"
export interface PermissionRequest {
  readonly action: PermissionAction
  readonly resources: readonly string[]
  readonly save?: readonly string[]
  readonly metadata?: Readonly<Record<string, unknown>>
}
export interface Invocation { readonly sessionID: string; readonly agent: string; readonly messageID: string; readonly id: string; readonly signal: AbortSignal }
/** Asserts each request in order. Host permission errors propagate unchanged. */
export type Authorize = (requests: readonly PermissionRequest[], invocation: Invocation) => Promise<void>

// Availability and failures

export const AVAILABILITY = [
  "AVAILABLE", "DISABLED", "CLOSED", "UNSUPPORTED_PLATFORM", "PLATFORM_PACKAGE_MISSING",
  "NATIVE_FILES_MISSING", "BINARY_MISSING", "INTEGRITY_MISMATCH", "CONTRACT_MISMATCH", "SPEECH_ASSETS_MISSING", "UNSAFE_PATH",
] as const
export type Availability = typeof AVAILABILITY[number]
export type FailureCode = Exclude<Availability, "AVAILABLE">
  | "HOST_UNTESTED" | "OPTIONS_INVALID" | "STATUS_UNAVAILABLE" | "SKILLS_INVALID" | "INPUT_INVALID" | "INPUT_LIMIT" | "OUTPUT_LIMIT" | "QUEUE_FULL" | "CANCELLED" | "DEADLINE_EXCEEDED"
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

/** `output` is the structured tool output; `text` is the content the model reads. */
export interface AdapterResult<O = unknown> { readonly output: O; readonly text: string }
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

// Status: one view for the utilities_status tool, the utilities-status command, the RPC `status` method and the TUI.

/**
 * The plugin's state in the shared machine form (S13). Utilities has no service to connect to, so it is `ready`,
 * unless every enabled module failed, or every module is off. It has no status-only mode: outside the supported range
 * setup refuses, so `host_untested` never occurs; an untested host shows only in `host.tested` and the OpenCode row.
 */
export const STATES = ["ready", "failed", "disabled"] as const
export type StatusState = typeof STATES[number]

/**
 * The shared status fields (S13) come first: `version`, `host`, `state`, `unguardedAgents` and `nextStep`, which is
 * exactly the `Next step` row. Elsewhere, an item's `next` is its own next step, present only when it needs action.
 */
export interface StatusView {
  readonly version: string
  /** `range` is package.json `opencode.host`; `tested` is true only for a release in the tested list. */
  readonly host: { readonly version: string | null; readonly range: string; readonly tested: boolean; readonly next?: string }
  readonly state: StatusState
  /** Agents that did not get the default ask rules and whose own rules would run a Utilities side effect without asking. */
  readonly unguardedAgents: readonly string[]
  readonly nextStep: string
  readonly platform: { readonly target: string; readonly package?: PlatformPackage; readonly availability: Availability; readonly next?: string }
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
  /** Skills with one of the plugin's ids that OpenCode loads instead of the plugin's own; empty when none. */
  readonly shadowedSkills: readonly { readonly name: string; readonly path: string }[]
  readonly permissions: { readonly askByDefault: readonly DefaultAskAction[] }
}

/** The status tool's output: the view with the unguarded agents as a count, and a next step that points to /utilities-status for them. */
export interface StatusSummary extends Omit<StatusView, "unguardedAgents"> {
  readonly unguardedAgents: number
}

/** Whether a module's skill and engine tools are registered. Speech stays registered while only its files are missing: the first call asks to download them. */
export function registrable(module: Module, availability: Availability) {
  return availability === "AVAILABLE" || (module === "speech" && availability === "SPEECH_ASSETS_MISSING")
}
/** Whether a tool is registered: status always, every other tool when its module is registrable. */
export function toolRegistrable(tool: ToolName, modules: { readonly [M in Module]: { readonly availability: Availability } }) {
  const entry = TOOLS[tool]
  return !("module" in entry) || registrable(entry.module, modules[entry.module].availability)
}

// Configuration and runtime

/** Plugin options. Defaults: every module on; stateRoot `$XDG_DATA_HOME/opencode-utilities`. */
export interface Config {
  readonly modules?: { readonly [M in Module]?: boolean }
  readonly stateRoot?: string
  readonly speech?: { readonly assetsDir?: string }
  readonly allowUntestedHost?: boolean
}
/**
 * From the public `ctx.location`: the project ID, the location directory and the project's directory. As in the
 * host's own file tools, a file under `projectDirectory` is inside the project even when it is outside `directory`.
 */
export interface ProjectLocation { readonly project: string; readonly directory: string; readonly projectDirectory: string }
export interface RuntimeOptions {
  readonly location: ProjectLocation
  readonly authorize: Authorize
  readonly modules: { readonly [M in Module]: boolean }
  readonly stateRoot: string
  /** `$XDG_CACHE_HOME/opencode-utilities` by default. */
  readonly cacheRoot: string
  /** Pre-seeded speech assets, verified by hash; nothing is downloaded. */
  readonly speechAssetsDir?: string
  /** A PLATFORMS key; anything else is an unsupported platform. Detected from the process by default. */
  readonly target?: string
  /** The Open-Meteo commercial key, if one is connected. */
  readonly weatherKey?: () => Promise<string | undefined>
  /** The installed package root, which holds manifest/. */
  readonly packageRoot?: string
}
/** Tools that run a module. `status` is composed by the host from `Runtime.status`. */
export type ModuleTool = { [K in ToolName]: typeof TOOLS[K] extends { readonly module: Module } ? K : never }[ToolName]
/** The StatusView items the runtime fills; the host fills version, host, weather and permissions. */
export type RuntimeStatus = Pick<StatusView, "platform" | "modules" | "speech" | "timers">
/** The view before its derived fields, `state` and `nextStep`, are filled in. */
export type StatusFacts = Omit<StatusView, "state" | "nextStep">
export interface SpeechInstallOutput { readonly downloaded: readonly { readonly name: string; readonly bytes: number }[]; readonly bytes: number; readonly cacheDirectory: string }
export interface Runtime {
  /** Runs a module tool: parse, availability, permission, any speech download, queue, then the deadline-bound work. Every permission request goes through `RuntimeOptions.authorize` before any effect. */
  invoke(tool: ModuleTool, input: unknown, invocation: Invocation): Promise<AdapterResult>
  status(signal?: AbortSignal): Promise<RuntimeStatus>
  /** Downloads every missing speech file. `authorize`, when given, receives the utilities_speech_download request first. */
  installSpeech(options?: { readonly signal?: AbortSignal; readonly authorize?: (requests: readonly PermissionRequest[]) => Promise<void> }): Promise<AdapterResult<SpeechInstallOutput>>
  /** Calls `listener` whenever a module's availability changes, for example after a speech download, so the host can reload its tools. Returns the unsubscribe function. */
  onAvailabilityChange(listener: () => void): () => void
  close(): Promise<void>
}
export type CreateRuntime = (options: RuntimeOptions) => Promise<Runtime>

// Native distribution

/**
 * One optional npm package per platform holds the time and weather binaries. The one platform table: the native
 * scripts import it too. `triple` is the Rust target; `arch` is what `file` (macOS) or `objdump -f` (Linux) reports
 * for a binary built for it.
 */
export const PLATFORMS = {
  "darwin-arm64": { package: "@joe-broadhead/opencode-utilities-bin-darwin-arm64", os: "darwin", cpu: "arm64", triple: "aarch64-apple-darwin", arch: "arm64" },
  "darwin-x64": { package: "@joe-broadhead/opencode-utilities-bin-darwin-x64", os: "darwin", cpu: "x64", triple: "x86_64-apple-darwin", arch: "x86_64" },
  "linux-x64-gnu": { package: "@joe-broadhead/opencode-utilities-bin-linux-x64-gnu", os: "linux", cpu: "x64", libc: "glibc", triple: "x86_64-unknown-linux-gnu", arch: "elf64-x86-64" },
  "linux-arm64-gnu": { package: "@joe-broadhead/opencode-utilities-bin-linux-arm64-gnu", os: "linux", cpu: "arm64", libc: "glibc", triple: "aarch64-unknown-linux-gnu", arch: "elf64-littleaarch64" },
} as const
export type Platform = keyof typeof PLATFORMS
export type PlatformPackage = typeof PLATFORMS[Platform]["package"]
export type PlatformModule = Exclude<Module, "speech">
/** manifest/backends.json. `path` is relative to the platform package root, for example `bin/time-keep`. */
export interface BackendManifest {
  readonly platforms: { readonly [P in Platform]?: { readonly [M in PlatformModule]: { readonly path: string; readonly sha256: string } } }
}

export const SPEECH_MODEL_ROLES = ["tiny-q5_1", "kitten-model", "kitten-voices", "kitten-config"] as const
type SpeechModelRole = typeof SPEECH_MODEL_ROLES[number]
export type SpeechAssetRole = "engine" | SpeechModelRole
/** A release file, cached at `<cacheRoot>/<sha256>/<name>`. */
export interface SpeechAsset { readonly name: string; readonly url: string; readonly sha256: string; readonly bytes: number }
/** manifest/speech-assets.json. URLs are `https://github.com/joe-broadhead/opencode-utilities/releases/download/v<version>/<file>`. */
export interface SpeechAssetManifest {
  readonly engines: { readonly [P in Platform]?: SpeechAsset }
  readonly models: { readonly [R in SpeechModelRole]: SpeechAsset }
}
