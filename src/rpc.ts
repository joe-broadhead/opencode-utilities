import { Rpc } from "@opencode/plugin/rpc"
import { AVAILABILITY, COMMANDS, DEFAULT_ASK, MODULES, PLATFORMS, PLUGIN_ID, SPEECH_MODEL_ROLES, STATES, TOOLS, WEATHER_ATTRIBUTION, registrable, toolRegistrable, type Availability, type Module, type StatusFacts, type StatusState, type StatusSummary, type StatusView, type ToolName } from "./domain/contract.js"
import { hostText } from "./host/versions.js"

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
  host: object({ version: { anyOf: [text(64), { type: "null" }] }, range: text(64), tested: { type: "boolean" }, next }, ["version", "range", "tested"]),
  state: choice(STATES),
  unguardedAgents: list(text(256), 256),
  nextStep: next,
  platform: object({ target: text(64), package: choice(Object.values(PLATFORMS).map(p => p.package)), availability, next }, ["target", "availability"]),
  modules: object({ weather: module, time: module, speech: module }, ["weather", "time", "speech"]),
  weather: object({ tier: choice(["free", "commercial"]), key: choice(["none", "connected", "rejected"]), attribution: { type: "string", const: WEATHER_ATTRIBUTION }, next }, ["tier", "key", "attribution"]),
  speech: object({
    assets: list(object({ role: choice(["engine", ...SPEECH_MODEL_ROLES]), name: text(256), bytes: count, state: choice(["missing", "cached", "pre-seeded"]) }, ["role", "name", "bytes", "state"]), 16),
    voices: list(text(64), 64),
    preseeded: { type: "boolean" },
    cacheDirectory: text(4096),
    outputDirectory: text(4096),
    next,
  }, ["assets", "voices", "preseeded", "cacheDirectory", "outputDirectory"]),
  timers: object({ due: count, directory: text(4096), next }, ["directory"]),
  permissions: object({ askByDefault: list(choice(DEFAULT_ASK), DEFAULT_ASK.length) }, ["askByDefault"]),
}, ["version", "host", "state", "unguardedAgents", "nextStep", "platform", "modules", "weather", "speech", "timers", "permissions"])

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
  return STATUS_JSON_SCHEMA.required.every(key => typeof v[key] === (key === "version" || key === "state" || key === "nextStep" ? "string" : "object"))
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

/** The fix for agents without the default rules, in one sentence. The block is shown with them. */
export const agentFix = (agents: readonly string[]) =>
  `Put the block shown under Agents without default rules first in the own permissions of ${agents.join(", ")} (agents.<name>.permissions in opencode.json, or the agent's front matter), followed by your top-level rules for utilities_* actions.`

/**
 * The single next step: the first item that needs the user, from blocking problems down. Optional items never drive
 * it: the free weather tier works without a key, and missing speech files download after a prompt on the first
 * speech call, so a fresh install reads `Nothing to do.` Their rows keep the hint. Missing pre-seeded files are a
 * misconfiguration, and do drive it.
 */
export function nextStep(view: Omit<StatusFacts, "version" | "permissions">) {
  const optional = view.modules.speech.availability === "UNSUPPORTED_PLATFORM" || view.modules.speech.availability === "SPEECH_ASSETS_MISSING" && !view.speech.preseeded
  const speech = optional ? undefined : view.modules.speech.next
  return view.host.next ?? view.platform.next ?? view.modules.time.next ?? view.modules.weather.next
    ?? (view.weather.key === "rejected" ? view.weather.next : undefined) ?? (view.unguardedAgents.length ? agentFix(view.unguardedAgents) : undefined)
    ?? view.timers.next ?? speech ?? NOTHING_TO_DO
}

/** ready, or why not: every enabled module failed, or every module is off. The host never changes it. */
export function stateOf(view: Pick<StatusFacts, "modules">): StatusState {
  const on = MODULES.filter(m => view.modules[m].availability !== "DISABLED")
  if (on.length === 0) return "disabled"
  return on.some(m => registrable(m, view.modules[m].availability)) ? "ready" : "failed"
}
/** The view with its derived fields. The status RPC, the command, the dialog and the tool all start here. */
export const completeStatus = (facts: StatusFacts): StatusView => {
  const { version, host, unguardedAgents, ...rest } = facts
  return { version, host, state: stateOf(facts), unguardedAgents, nextStep: nextStep(facts), ...rest }
}

/**
 * Every status row in the S9 order, ending with exactly one Next step: Connection (the optional Open-Meteo key),
 * Account, Access, the Utilities modules, Tools, the agents without default rules (with the block when `paste`),
 * OpenCode, Next step. `agents` replaces the agents row's text, for the compact tool output.
 */
export function statusLines(view: StatusView, { paste, agents }: { readonly paste: boolean; readonly agents?: string }): StatusLine[] {
  const missing = view.speech.assets.filter(asset => asset.state === "missing"), unguarded = view.unguardedAgents
  const registered = (Object.keys(TOOLS) as ToolName[]).filter(tool => toolRegistrable(tool, view.modules)).length
  const { key, tier, attribution } = view.weather
  const connection = key === "connected" ? "connected (Open-Meteo key)" : key === "rejected" ? "sign-in required (Open-Meteo rejected the key)" : "not configured (the Open-Meteo key is optional)"
  const download = missing.length === 0 ? "" : view.speech.preseeded ? ". Copy them into speech.assetsDir" : ". They download after a prompt on the first transcription or synthesis, or run /utilities-speech-install"
  return [
    line("Connection", connection, key !== "rejected"),
    line("Account", tier === "free" ? "Open-Meteo free tier" : "Open-Meteo commercial key", true),
    line("Access", `${tier === "free" ? "non-commercial use only, rate-limited" : "commercial use"}. ${attribution}`, true),
    line("Platform", view.platform.package ? `${view.platform.target}, ${view.platform.package}` : view.platform.target, view.platform.availability === "AVAILABLE"),
    ...MODULES.map(m => line(MODULE_TEXT[m], AVAILABILITY_TEXT[view.modules[m].availability], view.modules[m].availability === "AVAILABLE")),
    line("Speech files", missing.length === 0
      ? `${view.speech.assets.length === 0 ? "none" : view.speech.assets.map(a => `${a.name} ${a.state}`).join(", ")}${view.speech.voices.length ? `. Voices: ${view.speech.voices.join(", ")}` : ""}`
      : `${missing.length} of ${view.speech.assets.length} files missing (${megabytes(missing.reduce((n, a) => n + a.bytes, 0))})${download}`, missing.length === 0 || !view.speech.preseeded),
    line("Timers", `${view.timers.due === undefined ? "due count unknown" : `${view.timers.due} due`}. Stored in ${view.timers.directory}`, (view.timers.due ?? 0) === 0),
    line("Asks first", view.permissions.askByDefault.join(", "), true),
    line("Tools", `${registered} available, 0 unknown`, true),
    line(AGENTS_ROW, agents ?? (unguarded.length ? `${unguarded.join(", ")}${paste ? `\n${rulesToPaste(view)}` : ""}` : "none"), agents ? agents === "none" : unguarded.length === 0),
    line("OpenCode", `${hostText(view.host)}. Utilities ${view.version}`, view.host.tested),
    line("Next step", view.nextStep, view.nextStep === NOTHING_TO_DO),
  ]
}

const render = (lines: readonly StatusLine[]) => [STATUS_TITLE, ...lines.map(l => `${l.label}: ${l.text}`)].join("\n")

/** `/utilities-status`: every row, the block for agents without default rules, and the next step. */
export const formatStatus = (view: StatusView) => render(statusLines(view, { paste: true }))

/** The status tool's output: the same view, but the unguarded agents as a count, and their next step points to /utilities-status. */
export function compactStatus(view: StatusView): StatusSummary {
  const count = view.unguardedAgents.length
  const pointer = `${plural(count, "agent")} lack the default ask rules. Run /${COMMANDS.status} for the agents and the block to paste.`
  return { ...view, unguardedAgents: count, nextStep: count && view.nextStep === agentFix(view.unguardedAgents) ? pointer : view.nextStep }
}
export function formatSummary(summary: StatusSummary) {
  const view: StatusView = { ...summary, unguardedAgents: [] }
  return render(statusLines(view, { paste: false, agents: summary.unguardedAgents ? `${summary.unguardedAgents}` : "none" }))
}
