import * as z from "zod"
import { AVAILABILITY, MODULES, SPEECH_MODEL_ROLES, STATES, STOPGAPS, WEATHER_ATTRIBUTION, type DiagnoseView, type Module, type RuntimeStatus } from "../domain/contract.js"

/** `diagnose`'s answer, checked before the register checks it again: the shape a person and an agent read. */
export const DiagnoseSchema = z.strictObject({
  version: z.string().max(64),
  host: z.strictObject({ version: z.string().max(64).nullable(), range: z.string().max(64), tested: z.boolean() }),
  state: z.enum(STATES),
  access: z.enum(["all", "ask-changes", "read-only"]),
  stopgaps: z.array(z.strictObject({ tool: z.string().max(64), deletedWhen: z.string().max(512) })).max(8),
  nextStep: z.string().max(4096),
  platform: z.strictObject({ target: z.string().max(64), availability: z.enum(AVAILABILITY), next: z.string().max(4096).optional() }),
  modules: z.strictObject({
    weather: z.strictObject({ availability: z.enum(AVAILABILITY), next: z.string().max(4096).optional() }),
    time: z.strictObject({ availability: z.enum(AVAILABILITY), next: z.string().max(4096).optional() }),
    speech: z.strictObject({ availability: z.enum(AVAILABILITY), next: z.string().max(4096).optional() }),
  }),
  weather: z.strictObject({ tier: z.enum(["free", "commercial"]), key: z.enum(["none", "connected", "rejected"]), attribution: z.literal(WEATHER_ATTRIBUTION), next: z.string().max(4096).optional() }),
  speech: z.strictObject({
    assets: z.array(z.strictObject({ role: z.enum(["engine", ...SPEECH_MODEL_ROLES]), name: z.string().max(256), bytes: z.number().int().nonnegative(), state: z.enum(["missing", "cached", "pre-seeded"]) })).max(16),
    voices: z.array(z.string().max(64)).max(64),
    preseeded: z.boolean(),
    cacheDirectory: z.string().max(4096),
    outputDirectory: z.string().max(4096),
    next: z.string().max(4096).optional(),
  }),
  timers: z.strictObject({ due: z.number().int().nonnegative().optional(), directory: z.string().max(4096), next: z.string().max(4096).optional() }),
}) satisfies z.ZodType<DiagnoseView>

export interface DiagnoseInput {
  readonly version: string
  readonly host: { readonly version: string | null; readonly range: string; readonly tested: boolean }
  readonly access: DiagnoseView["access"]
  readonly runtime: RuntimeStatus
  readonly weather: DiagnoseView["weather"]
}

const NOTHING_TO_DO = "Nothing to do."

/** A module whose programs or files can be installed is usable; one that failed on this platform or is off is not. */
const usable = (module: Module, availability: RuntimeStatus["modules"][Module]["availability"]) =>
  availability === "AVAILABLE" || (module === "speech" ? availability === "SPEECH_ASSETS_MISSING" : availability === "NATIVE_FILES_MISSING")

/** ready, or why not: every enabled module failed, or every module is off. */
function stateOf(runtime: RuntimeStatus): DiagnoseView["state"] {
  const on = MODULES.filter(module => runtime.modules[module].availability !== "DISABLED")
  if (on.length === 0) return "disabled"
  return on.some(module => usable(module, runtime.modules[module].availability)) ? "ready" : "failed"
}

/**
 * The single next step: the first item that needs the user, from blocking problems down. Optional items never drive
 * it: the free weather tier works without a key, and missing speech files can be installed, so a fresh install reads
 * `Nothing to do.` Their rows keep the hint. Missing pre-seeded files are a misconfiguration and do drive it.
 */
function nextStep(input: DiagnoseInput): string {
  const speech = input.runtime.modules.speech.availability === "SPEECH_ASSETS_MISSING" && !input.runtime.speech.preseeded ? undefined : input.runtime.modules.speech.next
  return input.runtime.platform.next ?? input.runtime.modules.time.next ?? input.runtime.modules.weather.next
    ?? (input.weather.key === "rejected" ? input.weather.next : undefined) ?? input.runtime.timers.next ?? speech ?? NOTHING_TO_DO
}

/** The diagnose answer, from the runtime's facts and the host's static ones. */
export function diagnoseView(input: DiagnoseInput): DiagnoseView {
  return {
    version: input.version,
    host: input.host,
    state: stateOf(input.runtime),
    access: input.access,
    stopgaps: [...STOPGAPS],
    nextStep: nextStep(input),
    platform: input.runtime.platform,
    modules: input.runtime.modules,
    weather: input.weather,
    speech: input.runtime.speech,
    timers: input.runtime.timers,
  }
}
