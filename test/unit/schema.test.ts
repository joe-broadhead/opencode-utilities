// The JSON schema the register receives must keep property NAMES that happen to be `format` or `pattern`; only the
// schema KEYWORDS are dropped for OpenCode 2.4.1. `time_now`'s answer has a property named `format`.
import * as z from "zod"
import { describe, expect, test } from "vitest"
import { createHandlers } from "../../src/handlers/index.js"
import { InstallOutputSchema } from "../../src/handlers/install-output.js"
import { outputJson } from "../../src/handlers/schema.js"
import { TOOLS } from "../../src/domain/contract.js"
import { manifest, version } from "../../src/manifest.js"
import { DiagnoseSchema } from "../../src/provider/diagnostics.js"
import type { Provider } from "../../src/provider/index.js"
import { grepInput, grepOutput, sessionsInput, sessionsOutput } from "../../src/provider/modules/sessions/contracts.js"
import { speechInputs, speechOutputs } from "../../src/provider/modules/speech/contracts.js"
import { timeInputs, timeOutputs } from "../../src/provider/modules/time/contracts.js"
import { weatherInputs, weatherOutputs } from "../../src/provider/modules/weather/contracts.js"

const handler = createHandlers({ provider: {} as Provider, manifest, version, hostVersion: "2.4.1", access: "all" }) as unknown as Record<string, { input?: unknown; output?: unknown }>

const INPUTS = { time: timeInputs, weather: weatherInputs, speech: speechInputs } as const
const OUTPUTS = { time: timeOutputs, weather: weatherOutputs, speech: speechOutputs } as const

/** Every method backed by a zod schema, with the schema its handler publishes. `status` is contract-owned JSON. */
const ZOD: Record<string, { input?: z.ZodType; output?: z.ZodType }> = {}
for (const [method, { module, operation }] of Object.entries(TOOLS)) {
  const inputs = INPUTS[module] as Record<string, z.ZodType>, outputs = OUTPUTS[module] as Record<string, z.ZodType>
  ZOD[method] = { input: inputs[operation], output: outputs[operation] }
}
ZOD.sessions = { input: sessionsInput, output: sessionsOutput }
ZOD.sessions_grep = { input: grepInput, output: grepOutput }
ZOD.diagnose = { output: DiagnoseSchema }
ZOD.native_install = { output: InstallOutputSchema }
ZOD.speech_install = { output: InstallOutputSchema }

/** Every property name in a JSON Schema, in `properties` maps and every branch (anyOf/oneOf/allOf, items, $defs). */
function propertyNames(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) propertyNames(item, into)
    return into
  }
  if (value === null || typeof value !== "object") return into
  const node = value as Record<string, unknown>
  const properties = node["properties"]
  if (properties && typeof properties === "object" && !Array.isArray(properties)) {
    for (const [name, schema] of Object.entries(properties)) { into.add(name); propertyNames(schema, into) }
  }
  for (const [key, held] of Object.entries(node)) {
    if (key !== "properties" && held !== null && typeof held === "object") propertyNames(held, into)
  }
  return into
}

describe("the JSON schema the handlers publish", () => {
  test("(a) time_now keeps the property named format", () => {
    const schema = outputJson(timeOutputs.current_time) as { properties?: Record<string, unknown> }
    expect(Object.keys(schema.properties ?? {})).toContain("format")
  })

  test("(b) every zod-backed method keeps every property name its canonical schema has", () => {
    for (const [method, schemas] of Object.entries(ZOD)) {
      expect(handler[method], `${method} is registered`).toBeDefined()
      for (const io of ["input", "output"] as const) {
        const zod = schemas[io]
        if (zod === undefined) continue
        const canonical = z.toJSONSchema(zod, { io, unrepresentable: "any", target: "draft-2020-12" })
        const published = propertyNames(handler[method]![io])
        for (const name of propertyNames(canonical)) expect(published.has(name), `${method} ${io} property ${name}`).toBe(true)
      }
    }
  })

  test("(c) a realistic time_now answer parses with the published output schema", () => {
    const answer = {
      generated_at_utc: "2026-11-25T21:00:00Z",
      format: "rfc3339",
      times: [{
        timezone: "UTC", local_datetime: "2026-11-25T21:00:00+00:00", utc_datetime: "2026-11-25T21:00:00Z",
        display_datetime: "2026-11-25 21:00:00", utc_offset: "+00:00", utc_offset_seconds: 0, is_dst: false,
        abbreviation: "UTC", weekday: "Wednesday", iso_week: 48, iso_year: 2026, day_of_year: 329, unix_epoch: 1_764_104_400,
      }],
      machine_timezone: "UTC",
    }
    const parsed = z.fromJSONSchema(outputJson(timeOutputs.current_time) as never)
    expect(parsed.safeParse(answer).success).toBe(true)
  })

  test("(c) format and pattern are kept as property names, but dropped as schema keywords", () => {
    const schema = outputJson(z.object({
      outer: z.object({
        format: z.string(),
        pattern: z.string().regex(/^x$/),
        nested: z.object({ format: z.string() }),
      }),
    })) as { properties: { outer: { properties: Record<string, Record<string, unknown>> } } }
    const properties = schema.properties.outer.properties
    expect(Object.keys(properties)).toEqual(["format", "pattern", "nested"])
    expect(properties["pattern"]).not.toHaveProperty("pattern")
    expect(Object.keys(properties["nested"]!["properties"] as Record<string, unknown>)).toContain("format")
  })
})
