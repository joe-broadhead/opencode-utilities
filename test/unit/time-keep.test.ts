// The real time-keep program from this machine's platform package, which `npm run check` builds first
// (native:ensure). These tests pin what the synthetic fixture cannot: time-keep's own parsing and error messages.
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRuntime } from "../../src/runtime.js"
import type { Runtime } from "../../src/domain/contract.js"
import { timeFailure } from "../../src/modules/time/failures.js"
import { invocation } from "../fixtures.js"

const repo = fileURLToPath(new URL("../../", import.meta.url))
let root: string, runtime: Runtime
beforeAll(async () => {
  root = await mkdtemp(join(await realpath(tmpdir()), "utilities-time-keep-"))
  await mkdir(join(root, "state"), { mode: 0o700 }); await mkdir(join(root, "project"))
  runtime = await createRuntime({
    location: { project: "project-real", directory: join(root, "project"), projectDirectory: join(root, "project") }, authorize: async () => {},
    modules: { time: true, weather: false, speech: false }, stateRoot: join(root, "state"), cacheRoot: join(root, "cache"), packageRoot: repo,
  })
  // Fail loudly when the native files are not built: these tests never skip.
  expect((await runtime.status()).modules.time).toEqual({ availability: "AVAILABLE" })
})
afterAll(async () => { await runtime?.close(); if (root) await rm(root, { recursive: true, force: true }) })
const call = (tool: Parameters<Runtime["invoke"]>[0], input: object) => runtime.invoke(tool, input, invocation())

describe("daylight-saving changes and coverage get their own codes (UTIL-3, LIVE-4)", () => {
  test("a local time in a spring-forward gap is TIME_NONEXISTENT, naming the zone", async () => {
    for (const datetime of ["2026-03-29T02:30", "2026-03-29T02:30:00"]) {
      const error = await call("time_convert", { datetime, from_timezone: "Europe/Amsterdam", to_timezone: "UTC" }).catch(e => e)
      expect(error).toMatchObject({ code: "TIME_NONEXISTENT", message: "That local time is skipped by a daylight-saving change in Europe/Amsterdam, so it does not exist there.", hint: "Use a time outside the change, or add the UTC offset the user means to the datetime." })
    }
  })
  test("a local time in a fall-back overlap is TIME_AMBIGUOUS with both UTC offsets, and an offset settles it", async () => {
    const error = await call("time_convert", { datetime: "2026-10-25T02:30", from_timezone: "Europe/Amsterdam", to_timezone: "UTC" }).catch(e => e)
    expect(error).toMatchObject({
      code: "TIME_AMBIGUOUS",
      message: "That local time happens twice in Europe/Amsterdam, at a daylight-saving change: first at UTC+02:00 (2026-10-25T00:30:00Z), then at UTC+01:00 (2026-10-25T01:30:00Z).",
      hint: "Add the offset the user means to the datetime (+02:00 or +01:00), or ask the user which one they mean.",
    })
    const later = await call("time_convert", { datetime: "2026-10-25T02:30+01:00", from_timezone: "Europe/Amsterdam", to_timezone: "UTC" })
    expect(later.output).toMatchObject({ target: { utc_datetime: "2026-10-25T01:30:00Z" } })
    const west = await call("time_convert", { datetime: "2026-11-01 01:30:00", from_timezone: "America/New_York", to_timezone: "UTC" }).catch(e => e)
    expect(west).toMatchObject({ code: "TIME_AMBIGUOUS", message: expect.stringContaining("first at UTC-04:00 (2026-11-01T05:30:00Z), then at UTC-05:00 (2026-11-01T06:30:00Z)") })
  })
  test("an offset the zone does not use is TIME_OFFSET_MISMATCH, naming the zone's offset", async () => {
    const error = await call("time_convert", { datetime: "2026-07-01T12:00:00+05:00", from_timezone: "Europe/Amsterdam", to_timezone: "UTC" }).catch(e => e)
    expect(error).toMatchObject({ code: "TIME_OFFSET_MISMATCH", message: "The datetime's UTC offset is not the one Europe/Amsterdam uses at that moment (UTC+02:00)." })
  })
  test("a business day past the holiday data is HOLIDAY_COVERAGE, not BACKEND_FAILED", async () => {
    const error = await call("time_business_days", { mode: "next", date: "2030-12-31", country: "GB" }).catch(e => e)
    expect(error).toMatchObject({ code: "HOLIDAY_COVERAGE", message: "Holiday data covers 2000–2030, and this call needs a year outside it.", hint: "Use dates from 2000 to 2030, or leave out country to count weekends only." })
    await expect(call("time_business_days", { mode: "next", date: "2030-12-31" })).resolves.toMatchObject({ output: { business_date: "2031-01-01" } })
  })
})

test("date-times without seconds work everywhere the schemas accept them", async () => {
  await expect(call("time_convert", { datetime: "2026-10-30T12:00", from_timezone: "UTC", to_timezone: "Asia/Tokyo" })).resolves.toMatchObject({ output: { target: { local_datetime: "2026-10-30T21:00:00+09:00" } } })
  await expect(call("time_add", { date: "2026-10-30 12:00", operation: "add", amount: 1, unit: "hours" })).resolves.toMatchObject({ output: { result: "2026-10-30T13:00:00" } })
  await expect(call("time_between", { from: "2026-10-30T12:00Z", to: "2026-10-30T13:30+00:00" })).resolves.toMatchObject({ output: { signed_minutes: 90 } })
  await expect(call("time_format", { input: "2026-10-30T12:00Z", output_format: "epoch" })).resolves.toMatchObject({ output: { formatted: "1793361600" } })
  await expect(call("timer_set", { name: "minutes", deadline: "2026-11-02T09:00Z" })).resolves.toMatchObject({ output: { deadline_utc: "2026-11-02T09:00:00Z" } })
  await expect(call("time_convert", { datetime: "2026-10-30T12:00:00.5", from_timezone: "UTC", to_timezone: "UTC" })).rejects.toMatchObject({ code: "INPUT_INVALID", message: "The tool input is invalid. datetime: may have fractional seconds only with an offset, such as 2026-10-29T15:30:00.5+01:00." })
})

test("out-of-range dates name the range, not only \"Invalid input\" (LIVE-5)", async () => {
  await expect(call("time_holidays", { mode: "check", date: "2031-01-01", country: "GB" })).rejects.toMatchObject({ code: "INPUT_INVALID", message: "The tool input is invalid. date: must be from 2000 to 2030, the years the offline holiday data covers." })
  await expect(call("time_holidays", { mode: "list", year: 2031, country: "GB" })).rejects.toMatchObject({ message: "The tool input is invalid. year: must be from 2000 to 2030, the years the offline holiday data covers." })
  await expect(call("time_business_days", { mode: "between", from: "2030-12-01", to: "2031-01-10", country: "GB" })).rejects.toMatchObject({ message: "The tool input is invalid. to: must be from 2000 to 2030, the years the offline holiday data covers when country is given; leave out country to count weekends only." })
  await expect(call("time_business_days", { mode: "between", from: "2026-01-01", to: "2027-06-01" })).rejects.toMatchObject({ message: "The tool input is invalid. to: must be at most 366 days from from." })
  await expect(call("time_calendar", { date: "2026-02-30" })).rejects.toMatchObject({ message: "The tool input is invalid. date: must be a real date from 1900-01-01 to 2100-12-31." })
  await expect(call("time_convert", { datetime: "2026-10-30T12:00", from_timezone: "Mars/Olympus", to_timezone: "UTC" })).rejects.toMatchObject({ message: "The tool input is invalid. from_timezone: must be an IANA time zone name, such as Europe/London; call utilities_time_zones to find one." })
})

test("the other time-keep messages map by prefix, and unknown ones stay BACKEND_FAILED", () => {
  const report = (message: string) => ({ error: { error_code: "INVALID_PARAMS", message, details: { value: "private text" } } })
  const input = { datetime: "2026-10-30T12:00:00", from_timezone: "UTC", to_timezone: "UTC" }
  expect(timeFailure(report("date arithmetic overflowed supported range"), "date_arithmetic", input as never)).toMatchObject({ code: "TIME_OUT_OF_RANGE" })
  expect(timeFailure(report("deadline is outside the supported timestamp range"), "timer_set", input as never)).toMatchObject({ code: "TIME_OUT_OF_RANGE" })
  expect(timeFailure(report("could not find a business day inside supported range"), "business_days", input as never)).toMatchObject({ code: "HOLIDAY_COVERAGE" })
  expect(timeFailure(report("invalid ISO date or datetime: private text"), "date_format", input as never)).toMatchObject({ code: "INPUT_INVALID", message: expect.not.stringContaining("private") })
  // Only convert names a zone; the same message from another operation, or a garbled overlap, never guesses offsets.
  expect(timeFailure(report("ambiguous local datetime for timezone UTC: x"), "date_format", input as never)).toBeUndefined()
  expect(timeFailure(report("ambiguous local datetime for timezone UTC: x"), "convert_timezone", input as never)).toMatchObject({ code: "TIME_AMBIGUOUS", message: "That local time happens twice in UTC, at a daylight-saving change." })
  expect(timeFailure(report("something new"), "date_format", input as never)).toBeUndefined()
  expect(timeFailure({ error: { error_code: "INTERNAL", message: "holiday data supports years" } }, "holidays", input as never)).toBeUndefined()
})

describe("regional holidays (UTIL-4)", () => {
  const days = (output: unknown) => (output as { holidays: { date: string; nationwide: boolean; regions: string[] }[] }).holidays
  test("lists keep regional holidays, marked with a regions field; a region keeps only its own and the nationwide ones", async () => {
    const all = days((await call("time_holidays", { mode: "list", year: 2026, country: "GB" })).output)
    expect(all).toHaveLength(14)
    expect(all.find(h => h.date === "2026-12-25")).toMatchObject({ name: "Christmas Day", nationwide: true, regions: [] })
    expect(all.find(h => h.date === "2026-08-03")).toMatchObject({ name: "Summer Bank Holiday [Scotland]", nationwide: false, regions: ["Scotland"] })
    expect(all.find(h => h.date === "2026-04-06")).toMatchObject({ nationwide: false, regions: ["England", "Wales", "Northern Ireland"] })
    const scotland = await call("time_holidays", { mode: "list", year: 2026, country: "GB", region: "Scotland" })
    expect(scotland.output).toMatchObject({ region: "Scotland", count: 10 })
    expect(days(scotland.output).map(h => h.date)).not.toContain("2026-04-06")
    // One row joins a regional and a nationwide holiday: the row is nationwide.
    expect(days((await call("time_holidays", { mode: "list", year: 2023, country: "GB" })).output).find(h => h.date === "2023-01-02"))
      .toMatchObject({ name: "New Year Holiday [Scotland], New Year's Day (Observed)", nationwide: true, regions: [] })
    // A bracket elsewhere is an English name, not a region.
    expect(days((await call("time_holidays", { mode: "list", year: 2026, country: "AR" })).output).every(h => h.nationwide && h.regions.length === 0)).toBe(true)
    expect(days((await call("time_holidays", { mode: "list", year: 2026, country: "IM" })).output).find(h => h.date === "2026-11-30")).toMatchObject({ nationwide: false, regions: ["Scotland"] })
  })
  test("check marks the holiday; with a region, another region's holiday is not one", async () => {
    await expect(call("time_holidays", { mode: "check", date: "2026-08-03", country: "GB" })).resolves.toMatchObject({ output: { is_holiday: true, region: null, holiday: { regions: ["Scotland"], nationwide: false } } })
    const england = (await call("time_holidays", { mode: "check", date: "2026-08-03", country: "GB", region: "England" })).output
    expect(england).toMatchObject({ is_holiday: false, region: "England" }); expect(england).not.toHaveProperty("holiday")
    await expect(call("time_holidays", { mode: "check", date: "2026-08-03", country: "GB", region: "Scotland" })).resolves.toMatchObject({ output: { is_holiday: true } })
  })
  test("business days skip only nationwide holidays by default, and a region's own with region", async () => {
    const one = await call("time_business_days", { mode: "between", from: "2026-08-03", to: "2026-08-03", country: "GB" })
    expect(one.output).toMatchObject({ business_days: 1, holidays_skipped: [], regional_holidays_not_skipped: [{ date: "2026-08-03", regions: ["Scotland"] }] })
    await expect(call("time_business_days", { mode: "between", from: "2026-08-03", to: "2026-08-03", country: "GB", region: "Scotland" })).resolves.toMatchObject({ output: { business_days: 0, region: "Scotland" } })
    await expect(call("time_business_days", { mode: "between", from: "2026-08-01", to: "2026-08-31", country: "GB" })).resolves.toMatchObject({ output: { business_days: 21 } })
    await expect(call("time_business_days", { mode: "between", from: "2026-08-31", to: "2026-08-01", country: "GB", region: "England" })).resolves.toMatchObject({ output: { business_days: -20, holidays_skipped: [{ date: "2026-08-31" }] } })
    await expect(call("time_business_days", { mode: "between", from: "2026-12-21", to: "2026-12-31", country: "GB" })).resolves.toMatchObject({ output: { business_days: 7 } })
    // A country without regional rows keeps time-keep's own count.
    await expect(call("time_business_days", { mode: "between", from: "2026-12-21", to: "2026-12-31", country: "NL" })).resolves.toMatchObject({ output: { business_days: 8, regional_holidays_not_skipped: [] } })
  })
  test("next and previous step over nationwide holidays, and a region's own with region", async () => {
    const next = (date: string, extra: object = {}) => call("time_business_days", { mode: "next", date, country: "GB", ...extra }).then(r => r.output)
    await expect(next("2026-08-02")).resolves.toMatchObject({ business_date: "2026-08-03", days_moved: 1, mode: "country_holidays", country_code: "GB", region: null, coverage: { end_year: 2030 } })
    await expect(next("2026-08-02", { region: "Scotland" })).resolves.toMatchObject({ business_date: "2026-08-04", days_moved: 2 })
    await expect(next("2026-12-24")).resolves.toMatchObject({ business_date: "2026-12-29", days_moved: 5 })
    await expect(next("2026-12-31")).resolves.toMatchObject({ business_date: "2027-01-04" })
    await expect(next("2026-12-31", { region: "Scotland" })).resolves.toMatchObject({ business_date: "2027-01-05" })
    await expect(call("time_business_days", { mode: "prev", date: "2026-12-29", country: "GB" })).resolves.toMatchObject({ output: { business_date: "2026-12-24", direction: "previous", days_moved: 5 } })
    await expect(call("time_business_days", { mode: "prev", date: "2000-01-03", country: "GB" })).rejects.toMatchObject({ code: "HOLIDAY_COVERAGE" })
  })
  test("region is only for GB", async () => {
    await expect(call("time_holidays", { mode: "list", year: 2026, country: "US", region: "England" })).rejects.toMatchObject({ code: "INPUT_INVALID", message: "The tool input is invalid. region: is only for country GB, the one country whose holiday data has regions." })
    await expect(call("time_business_days", { mode: "next", date: "2026-08-02", region: "Scotland" })).rejects.toMatchObject({ code: "INPUT_INVALID" })
  })
})
