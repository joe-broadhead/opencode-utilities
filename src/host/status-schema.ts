import * as z from "zod"
import { AVAILABILITY, DEFAULT_ASK, PLATFORMS, SPEECH_MODEL_ROLES, STATES, WEATHER_ATTRIBUTION, type PlatformPackage, type StatusSummary, type StatusView } from "../domain/contract.js"

// Server only. The status RPC validates its answer with StatusSchema, and the status tool declares StatusSummarySchema
// as its output. The RPC contract itself is plain JSON Schema (src/rpc.ts); a unit test keeps the two identical.
const PACKAGES = Object.values(PLATFORMS).map(p => p.package) as [PlatformPackage, ...PlatformPackage[]]
const next = z.string().max(4096).optional()
const availability = z.enum(AVAILABILITY)
const module = z.strictObject({ availability, next })
export const StatusSchema = z.strictObject({
  version: z.string().max(64),
  host: z.strictObject({ version: z.string().max(64).nullable(), range: z.string().max(64), tested: z.boolean(), next }),
  state: z.enum(STATES),
  unguardedAgents: z.array(z.string().max(256)).max(256),
  nextStep: z.string().max(4096),
  platform: z.strictObject({ target: z.string().max(64), package: z.enum(PACKAGES).optional(), availability, next }),
  modules: z.strictObject({ weather: module, time: module, speech: module }),
  weather: z.strictObject({ tier: z.enum(["free", "commercial"]), key: z.enum(["none", "connected", "rejected"]), attribution: z.literal(WEATHER_ATTRIBUTION), next }),
  speech: z.strictObject({
    assets: z.array(z.strictObject({ role: z.enum(["engine", ...SPEECH_MODEL_ROLES]), name: z.string().max(256), bytes: z.number().int().nonnegative(), state: z.enum(["missing", "cached", "pre-seeded"]) })).max(16),
    voices: z.array(z.string().max(64)).max(64),
    preseeded: z.boolean(),
    cacheDirectory: z.string().max(4096),
    outputDirectory: z.string().max(4096),
    next,
  }),
  timers: z.strictObject({ due: z.number().int().nonnegative().optional(), directory: z.string().max(4096), next }),
  shadowedSkills: z.array(z.strictObject({ name: z.string().max(64), path: z.string().max(4096) })).max(8),
  permissions: z.strictObject({ askByDefault: z.array(z.enum(DEFAULT_ASK)).max(DEFAULT_ASK.length) }),
}) satisfies z.ZodType<StatusView>
/** The status tool's output schema: the unguarded agents are a count, and `nextStep` points to /utilities-status for them. */
export const StatusSummarySchema = StatusSchema.extend({
  unguardedAgents: z.number().int().nonnegative(),
}) satisfies z.ZodType<StatusSummary>
