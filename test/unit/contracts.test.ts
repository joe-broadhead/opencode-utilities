import { test, expect } from "vitest"
import { z } from "zod"
import { readFile } from "node:fs/promises"
import { DEFAULT_ASK, NAMESPACE_ACTION, SPEECH_DOWNLOAD_ACTION, TOOLS, WEATHER_ATTRIBUTION, type FailureCode, type ToolName } from "../../src/domain/contract.js"
import { FAILURES, formatFailure, UtilitiesError } from "../../src/domain/common.js"
import { StatusSchema } from "../../src/host/status-schema.js"
import { STATUS_JSON_SCHEMA } from "../../src/rpc.js"
import { TOOL_DEFINITIONS } from "../../src/domain/registry.js"
import { SKILLS } from "../../src/host/skills.js"
import { timeInputs, timeOutputs } from "../../src/modules/time/contracts.js"
import { timeArgv } from "../../src/modules/time/argv.js"
import { weatherInputs, weatherNativeOutputs, weatherOutputs, CURRENT_UNITS, DAILY_UNITS, HOURLY_UNITS } from "../../src/modules/weather/contracts.js"
import { weatherArgv } from "../../src/modules/weather/argv.js"
import { speechInputs, speechOutputs } from "../../src/modules/speech/contracts.js"
import { validateWav } from "../../src/artifacts/wav.js"
import { weatherBase, wav } from "../fixtures.js"
import { INPUTS, SAMPLES } from "../host/samples.js"
import { NEXT_STEPS } from "../../src/host/tools-rpc.js"

type Shape = { properties?: Record<string, { description?: string }>; oneOf?: Shape[]; anyOf?: Shape[] }
const fields = (schema: Shape): [string, string | undefined][] => [
  ...Object.entries(schema.properties ?? {}).map(([name, property]): [string, string | undefined] => [name, property.description]),
  ...[...schema.oneOf ?? [], ...schema.anyOf ?? []].flatMap(fields),
]

test("the tool table is the contract's 24 tools, each with a description, bounded schemas and described fields", () => {
  expect(TOOL_DEFINITIONS.map(t => t.name)).toEqual(Object.keys(TOOLS))
  expect(TOOL_DEFINITIONS).toHaveLength(24)
  expect(TOOL_DEFINITIONS.filter(t => t.name.startsWith("timer_")).map(t => t.name)).toEqual(["timer_set", "timer_get", "timer_list", "timer_check", "timer_delete"])
  expect(TOOL_DEFINITIONS.filter(t => t.pinned)).toEqual([])
  for (const tool of TOOL_DEFINITIONS) {
    expect(tool.module).toBe((TOOLS[tool.name] as { module?: string }).module)
    expect(tool.description.length, tool.name).toBeGreaterThan(60)
    expect(tool.description).not.toMatch(/\butilities\.\w|policy|catalog|artifact/i)
    const input = z.toJSONSchema(tool.input, { io: "input" }) as Shape
    for (const [field, description] of fields(input)) expect(`${tool.name}.${field}: ${description ?? ""}`).toMatch(/: \S/)
    expect(z.toJSONSchema(tool.output)).toBeTruthy()
  }
})

test("every sample input and output fits its tool's schema", () => {
  for (const tool of TOOL_DEFINITIONS) {
    expect(tool.input.safeParse(INPUTS[tool.name]).success, tool.name).toBe(true)
    if (tool.name !== "status") expect(tool.output.safeParse(SAMPLES[tool.name as Exclude<ToolName, "status">].output).error, tool.name).toBeUndefined()
  }
})

test("the three skills have valid front matter and name only real tools and actions", async () => {
  const known = new Set([...Object.keys(TOOLS).map(name => `utilities_${name}`), ...DEFAULT_ASK, SPEECH_DOWNLOAD_ACTION, NAMESPACE_ACTION, "utilities_weather_*"])
  for (const id of Object.keys(SKILLS)) {
    const text = await readFile(new URL(`../../skills/${id}/SKILL.md`, import.meta.url), "utf8")
    const front = /^---\nname: (.+)\ndescription: (.+)\n---\n/.exec(text)
    expect(front?.[1]).toBe(id)
    expect(front?.[2]?.length).toBeGreaterThan(30)
    for (const name of text.match(/utilities_[a-z_*]+/g) ?? []) expect(known.has(name), `${id}: ${name}`).toBe(true)
    // No Code Mode paths or plugin ids; the one id a skill may name is the tools RPC that scripts call.
    expect(text.replaceAll("/api/rpc/utilities.local.tools/", "").replaceAll("`utilities.local.tools`", "")).not.toMatch(/\butilities\.\w|catalog|artifact/)
  }
})

test("transcription takes a path, synthesis writes a .wav file, and weather results carry the attribution", () => {
  expect(speechInputs.transcribe.parse({ path: "clip.wav" })).toEqual({ path: "clip.wav" })
  expect(speechInputs.transcribe.safeParse({ inputPath: "/clip.wav" }).success).toBe(false)
  expect(speechInputs.synthesize.safeParse({ text: "hi", path: "out.wav" }).success).toBe(true)
  expect(speechInputs.synthesize.safeParse({ text: "hi", path: "out.mp3" }).success).toBe(false)
  expect(Object.keys(speechInputs)).toEqual(["transcribe", "synthesize"])
  expect(speechOutputs.synthesize.safeParse({ path: "/a.wav", bytes: 44, sha256: "a".repeat(64), durationMs: 0, sampleRateHz: 24000, channels: 1, voice: "Luna" }).success).toBe(true)
  const place = weatherBase.location
  expect(weatherOutputs.geocode.safeParse({ locations: [place], attribution: WEATHER_ATTRIBUTION }).success).toBe(true)
  expect(weatherOutputs.geocode.safeParse([place]).success).toBe(false)
  const current = { ...weatherBase, current: { time: "2026-10-29T12:00", interval: 900, ...Object.fromEntries(Object.keys(CURRENT_UNITS).map(k => [k, null])) }, units: CURRENT_UNITS }
  expect(weatherOutputs.current.safeParse(current).success).toBe(false)
  expect(weatherOutputs.current.safeParse({ ...current, attribution: WEATHER_ATTRIBUTION }).success).toBe(true)
})

test("the RPC status contract is plain JSON Schema with exactly the validation of the server's zod schema", () => {
  const { $schema, ...fromZod } = z.toJSONSchema(StatusSchema, { io: "output" }) as Record<string, unknown>
  expect($schema).toBeDefined()
  expect(JSON.parse(JSON.stringify(STATUS_JSON_SCHEMA))).toEqual(fromZod)
})
test("every failure says what happened and gives one next step", () => {
  for (const [code, [message, hint]] of Object.entries(FAILURES)) {
    expect(code, code).toMatch(/^[A-Z][A-Z0-9_]*$/)
    expect(message, code).toMatch(/^[A-Z].*\.$/)
    expect(hint, code).toMatch(/^[A-Z].*\.$/)
    expect(formatFailure(new UtilitiesError(code as FailureCode))).toBe(`${code}: ${message} Next step: ${hint}`)
  }
})
test("the documented error tables list exactly the codes the plugin raises, in both directions (UTIL-R5)", async () => {
  const codes = async (file: string) => {
    const text = await readFile(new URL(`../../docs/${file}`, import.meta.url), "utf8"), section = text.slice(text.indexOf("\n## Errors"))
    const rows = section.slice(0, section.indexOf("\n## ", 4) === -1 ? undefined : section.indexOf("\n## ", 4)).split("\n").filter(line => line.startsWith("| `"))
    return rows.flatMap(row => [...row.split("|")[1]!.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map(m => m[1]!)).sort()
  }
  // Every FailureCode is raised somewhere (fail, UtilitiesError, an availability or a host check), and FAILURES has each.
  expect(await codes("configuration.md")).toEqual(Object.keys(FAILURES).sort())
  // The tools RPC's own codes: those its Utilities block gives a next step, and no MCP-only one.
  expect(await codes("scripting.md")).toEqual(Object.keys(NEXT_STEPS).sort())
})
test("a holiday country is a two-letter pattern, not a 100-value enum, and an unknown one names the supported list (UTIL-R22)", () => {
  const schema = JSON.stringify(z.toJSONSchema(timeInputs.holidays, { io: "input" }))
  expect(schema).not.toContain('"ZW"'); expect(schema).toContain("^[A-Z]{2}$")
  expect(timeInputs.holidays.safeParse({ mode: "list", year: 2026, country: "GB" }).success).toBe(true)
  const unknown = timeInputs.holidays.safeParse({ mode: "list", year: 2026, country: "XX" })
  expect(unknown.success).toBe(false); expect(unknown.error!.issues[0]!.message).toMatch(/^has no holiday data\. Supported: AE, AM, .*, GB, .*, ZW$/)
  expect(timeInputs.business_days.safeParse({ mode: "next", date: "2026-01-01", country: "gb" }).error!.issues[0]!.message).toBe("must be an ISO 3166-1 alpha-2 code in capitals, such as GB")
})
test("every weather tool says to stop when the user declines, and to geocode a shared name first (it1 grading)", () => {
  for (const tool of TOOL_DEFINITIONS.filter(t => t.module === "weather")) {
    expect(tool.description, tool.name).toContain("if the user declines, say no weather was fetched and stop, without getting weather from another site or calling Open-Meteo directly")
    const location = (z.toJSONSchema(tool.input, { io: "input" }) as { properties: Record<string, { description?: string }> }).properties.location
    if (location) expect(location.description, tool.name).toContain("call utilities_weather_geocode first")
  }
})
test("both speech tools start by saying to make the call while files are missing, since its download prompt is the consent (it3 grading)", () => {
  for (const name of ["speech_transcribe", "speech_synthesize"] as const) {
    expect(TOOL_DEFINITIONS.find(t => t.name === name)!.description, name).toMatch(/^Call this even when speech files are missing; the download prompt is how the user agrees\. Don't ask in text first\. /)
  }
})
test("timezone explicitness, invalid dates, historical and holiday bounds", () => {
  expect(timeInputs.current_time.parse({})).toEqual({ timezones: ["UTC"], format: "rfc3339" })
  for (const date of ["2026-02-30", "1899-01-01", "2101-01-01"]) expect(timeInputs.calendar_query.safeParse({ date }).success).toBe(false)
  for (const year of [1999, 2031]) expect(timeInputs.holidays.safeParse({ mode: "list", country: "GB", year }).success).toBe(false)
  expect(timeInputs.business_days.safeParse({ mode: "between", from: "2030-12-20", to: "2031-01-04", country: "GB" }).success).toBe(false)
  expect(timeInputs.business_days.safeParse({ mode: "between", from: "2030-12-20", to: "2031-01-04" }).success).toBe(true)
  expect(timeInputs.business_days.safeParse({ mode: "between", from: "2026-01-01", to: "2026-01-02", skip_holidays: true }).success).toBe(false)
  expect(timeInputs.convert_timezone.safeParse({ datetime: "2026-01-01T00:00:00", from_timezone: "fake", to_timezone: "UTC" }).success).toBe(false)
})
test("a date or date-time is one string with one pattern, so the schema the model reads shows it (UTIL-R22)", () => {
  const input = z.toJSONSchema(timeInputs.date_format, { io: "input" }) as unknown as { properties: { input: { type?: string; pattern?: string; anyOf?: unknown } } }
  expect(input.properties.input).toMatchObject({ type: "string", pattern: expect.any(String) }); expect(input.properties.input.anyOf).toBeUndefined()
  for (const ok of ["2026-10-29", "2026-10-29T15:30", "2026-10-29 15:30:00", "2026-10-29T15:30:00.5Z", "2026-10-29T15:30:00+01:00"]) expect(timeInputs.date_diff.safeParse({ from: ok, to: ok }).success).toBe(true)
  for (const bad of ["2026-02-30", "2026-10-29T24:00", "2026-10-29T", "2101-01-01T00:00", "29/10/2026"]) expect(timeInputs.date_diff.safeParse({ from: bad, to: "2026-10-29" }).success).toBe(false)
})
test("all fifteen time argv mappings are fixed and options never consume positionals", () => {
  const cases: Record<string, unknown> = { current_time: {}, list_timezones: { region: "Europe" }, timezone_info: { timezone: "UTC" }, convert_timezone: { datetime: "2026-10-29T12:00:00", from_timezone: "UTC", to_timezone: "Europe/London" }, calendar_query: { date: "2026-10-29" }, date_arithmetic: { date: "2026-01-31", operation: "add", amount: 1, unit: "months" }, date_diff: { from: "2026-01-01", to: "2026-01-02" }, date_format: { input: "2026-01-01", output_format: "epoch" }, holidays: { mode: "list", country: "GB", year: 2026 }, business_days: { mode: "next", date: "2026-10-29" }, timer_set: { name: "--config=/secret", deadline: "2027-01-01T00:00:00Z", description: "--tag=secret", tags: ["--help"] }, timer_get: { name: "-x" }, timer_delete: { name: "-x" }, timer_list: { tag: "-x" }, timer_check: {} }
  for (const [name, value] of Object.entries(cases)) {
    const op = name as keyof typeof timeInputs, args = timeArgv(op, timeInputs[op].parse(value), { config: "/private/config", store: "/private/store" })
    expect(args.slice(0, 3)).toEqual(["--output=json", "--config=/private/config", "--data-dir=/private/store"])
    expect(args).not.toContain("server")
    if (name === "timer_set") expect(args.slice(args.indexOf("--") + 1)).toEqual(["--config=/secret", "2027-01-01T00:00:00Z"])
  }
  expect(Object.keys(cases).sort()).toEqual(Object.keys(timeInputs).sort())
})
test("business days between two dates skip the given country's holidays, and only weekends without one", () => {
  const argv = (value: object) => timeArgv("business_days", timeInputs.business_days.parse(value), { config: "/c", store: "/s" }).slice(3)
  expect(argv({ mode: "between", from: "2026-12-21", to: "2026-12-28", country: "GB" })).toEqual(["biz", "between", "--country=GB", "--skip-holidays", "--", "2026-12-21", "2026-12-28"])
  expect(argv({ mode: "between", from: "2026-12-21", to: "2026-12-28" })).toEqual(["biz", "between", "--", "2026-12-21", "2026-12-28"])
  expect(argv({ mode: "next", date: "2026-12-24", country: "GB" })).toEqual(["biz", "next", "--country=GB", "--", "2026-12-24"])
})
test("all six weather argv mappings terminate options including negative coordinates", () => {
  for (const op of Object.keys(weatherInputs) as Array<keyof typeof weatherInputs>) {
    const value = op === "geocode" ? { query: "--help" } : { location: "-33.9,18.4" }
    const args = weatherArgv(op, weatherInputs[op].parse(value), "/private/config")
    expect(args.at(-2)).toBe("--"); expect(args.at(-1)).toBe(op === "geocode" ? "--help" : "-33.9,18.4")
    expect(args).toContain("--timeout=10s")
  }
})
test("weather nulls remain null; unknown fields, wrong series lengths and nonfinite values fail", () => {
  const current = { ...weatherBase, current: { time: "2026-10-29T12:00", interval: 900, ...Object.fromEntries(Object.keys(CURRENT_UNITS).map(k => [k, null])) } }
  expect((weatherNativeOutputs.current.parse(current).current as Record<string, unknown>).temperature_2m).toBeNull()
  expect(weatherNativeOutputs.current.safeParse({ ...current, injected: "secret" }).success).toBe(false)
  for (const [kind, units] of [["daily", DAILY_UNITS], ["hourly", HOURLY_UNITS]] as const) {
    const series = { time: ["2026-10-29"], ...Object.fromEntries(Object.keys(units).map(k => [k, [null]])) }
    expect(weatherNativeOutputs[kind].safeParse({ ...weatherBase, [kind]: series }).success).toBe(true)
    expect(weatherNativeOutputs[kind].safeParse({ ...weatherBase, [kind]: { ...series, weather_code: [] } }).success).toBe(false)
    expect(weatherNativeOutputs[kind].safeParse({ ...weatherBase, [kind]: { ...series, weather_code: [Infinity] } }).success).toBe(false)
  }
})
test("timer output counts and speech DTO versions fail closed", () => {
  expect(timeOutputs.timer_list.safeParse({ count: 1, timers: [] }).success).toBe(false)
  expect(speechOutputs.transcribe.safeParse({ schema_version: 1, text: "lossy DTO" }).success).toBe(false)
  expect(timeInputs.timer_set.safeParse({ name: "\u0085existing", deadline: "2027-01-01T00:00:00Z" }).success).toBe(false)
  expect(timeInputs.timer_set.safeParse({ name: "x", deadline: "2027-01-01T00:00:00Z", description: "😀".repeat(600) }).success).toBe(false)
})
test("PCM WAV validates actual bytes and rejects truncation, codec fallback and duration bombs", () => {
  const bytes = wav(); expect(validateWav(bytes).duration).toBe(0.1)
  expect(() => validateWav(bytes.subarray(0, -1))).toThrow(expect.objectContaining({ code: "WAV_INVALID" }))
  const compressed = Buffer.from(bytes); compressed.writeUInt16LE(3, 20); expect(() => validateWav(compressed)).toThrow(expect.objectContaining({ code: "WAV_UNSUPPORTED" }))
  const bad = Buffer.from(bytes); bad.writeUInt32LE(0xffffffff, 40); expect(() => validateWav(bad)).toThrow(expect.objectContaining({ code: "WAV_INVALID" }))
})
