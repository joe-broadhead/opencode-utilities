import { Rpc } from "@opencode/plugin/rpc"
import { AVAILABILITY, COMMANDS, DEFAULT_ASK, MODULES, PLATFORMS, PLUGIN_ID, SPEECH_MODEL_ROLES, TOOLS, WEATHER_ATTRIBUTION, toolRegistrable, type Availability, type Module, type StatusSummary, type StatusView, type ToolName } from "./domain/contract.js"

// The status contract in plain JSON Schema, so the TUI bundle carries no zod. The types are StatusView and
// StatusSummary in contract.ts. The server's zod copy (host/status-schema.ts) validates before answering, and a unit
// test keeps the two schemas identical.
const text = (maxLength: number) => ({ type: "string", maxLength }) as const
const choice = <const T extends readonly string[]>(values: T) => ({ type: "string", enum: values }) as const
const count = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER } as const
const list = <T extends object>(items: T, maxItems: number) => ({ type: "array", items, maxItems }) as const
const object = <P extends Record<string, object>, R extends readonly (keyof P & string)[]>(properties: P, required: R) =>
  ({ type: "object", properties, required, additionalProperties: false }) as const
const next = text(4096)
const availability = choice(AVAILABILITY)
const module = object({ availability, next }, ["availability"])

/** The RPC `status` output, field for field the same as the server's zod StatusSchema. */
export const STATUS_JSON_SCHEMA = object({
  version: text(64),
  host: object({ required: text(64), found: text(64), availability: choice(["AVAILABLE", "HOST_UNTESTED"]), next }, ["required", "found", "availability"]),
  platform: object({ target: text(64), package: choice(Object.values(PLATFORMS).map(p => p.package)), availability, next }, ["target", "availability"]),
  modules: object({ weather: module, time: module, speech: module }, ["weather", "time", "speech"]),
  weather: object({ tier: choice(["free", "commercial"]), key: choice(["none", "connected", "rejected"]), attribution: { type: "string", const: WEATHER_ATTRIBUTION }, next }, ["tier", "key", "attribution"]),
  speech: object({
    assets: list(object({ role: choice(["engine", ...SPEECH_MODEL_ROLES]), name: text(256), bytes: count, state: choice(["missing", "cached", "pre-seeded"]) }, ["role", "name", "bytes", "state"]), 16),
    voices: list(text(64), 64),
    cacheDirectory: text(4096),
    outputDirectory: text(4096),
    next,
  }, ["assets", "voices", "cacheDirectory", "outputDirectory"]),
  timers: object({ due: count, directory: text(4096), next }, ["directory"]),
  permissions: object({ askByDefault: list(choice(DEFAULT_ASK), DEFAULT_ASK.length), unguardedAgents: list(text(256), 256), next }, ["askByDefault", "unguardedAgents"]),
}, ["version", "host", "platform", "modules", "weather", "speech", "timers", "permissions"])

/** The plugin's only RPC method. The TUI view reads the status through it. */
export const Utilities = Rpc.define({
  id: PLUGIN_ID,
  methods: { status: { input: object({}, []), output: STATUS_JSON_SCHEMA, errors: { unavailable: object({ nextStep: { type: "string" } }, ["nextStep"]) } } },
  events: {},
})

/** JSON Schema outputs reach clients unchecked, so the TUI confirms the fields it reads. */
export function isStatus(value: unknown): value is StatusView {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  return STATUS_JSON_SCHEMA.required.every(key => typeof v[key] === "object" || key === "version" && typeof v[key] === "string")
}

const AVAILABILITY_TEXT: { readonly [A in Availability]: string } = {
  AVAILABLE: "ready",
  DISABLED: "disabled",
  CLOSED: "shutting down",
  HOST_UNTESTED: "host untested",
  UNSUPPORTED_PLATFORM: "not supported on this platform",
  PLATFORM_PACKAGE_MISSING: "failed: platform package missing",
  BINARY_MISSING: "failed: program missing",
  INTEGRITY_MISMATCH: "failed: integrity check",
  CONTRACT_MISMATCH: "failed: unexpected program version",
  SPEECH_ASSETS_MISSING: "speech files not downloaded yet",
  UNSAFE_PATH: "failed: a symbolic link inside the plugin's folders",
}
const MODULE_TEXT: { readonly [M in Module]: string } = { time: "Time and timers", weather: "Weather", speech: "Speech" }
const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`
const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

export const STATUS_TITLE = "Utilities status"
export const NOTHING_TO_DO = "Nothing to do."
const AGENTS_ROW = "Agents without default rules"

/** One row: a label and its text, which may run over several lines. `ok` is false when the row needs the user. */
export interface StatusLine { readonly label: string; readonly text: string; readonly ok: boolean }
const line = (label: string, text: string, ok: boolean): StatusLine => ({ label, text, ok })

/** The block for agents without the default rules, one rule per line, to put first in their own permissions. */
export const rulesToPaste = (view: Pick<StatusView, "permissions">) =>
  ["[", ...view.permissions.askByDefault.map((action, i, all) => `  ${JSON.stringify({ action, resource: "*", effect: "ask" })}${i < all.length - 1 ? "," : ""}`), "]"].join("\n")

/**
 * The single next step: the first item that needs the user, from blocking problems down to optional ones. The free
 * weather tier's note comes last because nothing is wrong.
 */
export function nextStep(view: Pick<StatusView, "host" | "platform" | "modules" | "weather" | "speech" | "timers"> & { readonly permissions: { readonly next?: string } }) {
  return view.host.next ?? view.platform.next ?? view.modules.time.next ?? view.modules.weather.next
    ?? (view.weather.key === "rejected" ? view.weather.next : undefined) ?? view.permissions.next ?? view.timers.next
    ?? view.modules.speech.next ?? view.speech.next ?? view.weather.next
}

/**
 * Every status row in the S9 order, ending with exactly one Next step: Connection (the optional Open-Meteo key),
 * Account, Access, the Utilities modules, Tools, the agents without default rules (with the block when `paste`),
 * OpenCode, Next step. `agents` replaces the agents row's text, for the compact tool output.
 */
export function statusLines(view: StatusView, { paste, agents }: { readonly paste: boolean; readonly agents?: string }): StatusLine[] {
  const missing = view.speech.assets.filter(asset => asset.state === "missing"), unguarded = view.permissions.unguardedAgents
  const registered = (Object.keys(TOOLS) as ToolName[]).filter(tool => toolRegistrable(tool, view.modules)).length
  const { key, tier, attribution } = view.weather
  const connection = key === "connected" ? "connected (Open-Meteo key)" : key === "rejected" ? "sign-in required (Open-Meteo rejected the key)" : "not configured (the Open-Meteo key is optional)"
  const host = view.host.availability === "AVAILABLE" ? `${view.host.found} (tested)` : `${view.host.found} (host untested: tested on ${view.host.required})`
  return [
    line("Connection", connection, key !== "rejected"),
    line("Account", tier === "free" ? "Open-Meteo free tier" : "Open-Meteo commercial key", true),
    line("Access", `${tier === "free" ? "non-commercial use only, rate-limited" : "commercial use"}. ${attribution}`, true),
    line("Platform", view.platform.package ? `${view.platform.target}, ${view.platform.package}` : view.platform.target, view.platform.availability === "AVAILABLE"),
    ...MODULES.map(m => line(MODULE_TEXT[m], AVAILABILITY_TEXT[view.modules[m].availability], view.modules[m].availability === "AVAILABLE")),
    line("Speech files", missing.length === 0
      ? `${view.speech.assets.length === 0 ? "none" : view.speech.assets.map(a => `${a.name} ${a.state}`).join(", ")}${view.speech.voices.length ? `. Voices: ${view.speech.voices.join(", ")}` : ""}`
      : `${missing.length} of ${view.speech.assets.length} files missing (${megabytes(missing.reduce((n, a) => n + a.bytes, 0))} to download)`, missing.length === 0),
    line("Timers", `${view.timers.due === undefined ? "due count unknown" : `${view.timers.due} due`}. Stored in ${view.timers.directory}`, (view.timers.due ?? 0) === 0),
    line("Asks first", view.permissions.askByDefault.join(", "), true),
    line("Tools", `${registered} available, 0 unknown`, true),
    line(AGENTS_ROW, agents ?? (unguarded.length ? `${unguarded.join(", ")}${paste ? `\n${rulesToPaste(view)}` : ""}` : "none"), agents ? agents === "none" : unguarded.length === 0),
    line("OpenCode", `${host}. Utilities ${view.version}`, view.host.availability === "AVAILABLE"),
    line("Next step", nextStep(view) ?? NOTHING_TO_DO, nextStep(view) === undefined),
  ]
}

const render = (lines: readonly StatusLine[]) => [STATUS_TITLE, ...lines.map(l => `${l.label}: ${l.text}`)].join("\n")

/** `/utilities-status`: every row, the block for agents without default rules, and the next step. */
export const formatStatus = (view: StatusView) => render(statusLines(view, { paste: true }))

/** The status tool's output: the same view, but the unguarded agents as a count with a pointer to /utilities-status. */
export function compactStatus(view: StatusView): StatusSummary {
  const count = view.permissions.unguardedAgents.length
  const permissions = { askByDefault: view.permissions.askByDefault, unguardedAgents: count, ...count ? { next: `${plural(count, "agent")} lack the default ask rules. Run /${COMMANDS.status} for the agents and the rules to paste.` } : {} }
  const summary = { ...view, permissions }, next = nextStep(summary)
  return { ...summary, ...next ? { next } : {} }
}
export function formatSummary(summary: StatusSummary) {
  const { unguardedAgents, next } = summary.permissions
  const view: StatusView = { ...summary, permissions: { askByDefault: summary.permissions.askByDefault, unguardedAgents: [], ...next ? { next } : {} } }
  return render(statusLines(view, { paste: false, agents: unguardedAgents ? `${unguardedAgents}` : "none" }))
}
