import * as z from "zod"
import { date, dateOrTime, datetime, instant, zone, text, byteText, integer } from "../../domain/common.js"
import { GB_REGIONS } from "./regions.js"

const country = z.enum("AE AM AO AR AT AU AW AZ BA BD BE BG BI BO BR BW BY CA CH CL CN CO CU CW CY CZ DE DJ DK DO EE EG ES ET FI FR GB GE GR HK HN HR HU ID IE IL IM IN IS IT JM JP KE KR KZ LI LS LT LU LV MA MD MG MK MT MW MX MY MZ NA NG NI NL NO NZ PE PK PL PT PY RO RS RU SA SE SG SI SK SZ TN TR TW UA US UY UZ VE VN ZA ZM ZW".split(" "))
const holidayCountry = country.describe("ISO 3166-1 alpha-2 country code, for example GB or US.")
const region = z.enum(GB_REGIONS).optional()
  .describe("Only with country GB: England, Wales, Scotland or Northern Ireland. That nation's own holidays then count as well as the nationwide ones.")
const regionNeedsGB = (v: { country?: string; region?: string }, ctx: z.core.$RefinementCtx) => {
  if (v.region !== undefined && v.country !== "GB") ctx.addIssue({ code: "custom", path: ["region"], message: "is only for country GB, the one country whose holiday data has regions" })
}
const COVERAGE = "must be from 2000 to 2030, the years the offline holiday data covers"
const covered = (s: string) => s >= "2000-01-01" && s <= "2030-12-31"
const holidayDate = date.refine(covered, COVERAGE)
// Match Rust str::trim, including NEL, without JS-only BOM trimming.
export const timerName = text(128).min(1).refine(s => s === s.replace(/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, ""))
const name = timerName.describe("Timer name, unique within this project. 1-128 characters, no leading or trailing spaces.")
const tag = text(64).trim().min(1)
const format = z.enum(["rfc3339", "iso8601", "epoch"])
const page = {
  offset: integer.min(0).max(999).default(0).describe("Number of timers to skip, for paging. Default 0."),
  limit: integer.min(1).max(100).default(20).describe("Maximum timers to return, 1-100. Default 20."),
}
export const timeInputs = {
  current_time: z.strictObject({
    timezones: z.array(zone).min(1).max(16).default(["UTC"]).describe("IANA time zones to report, for example [\"Europe/London\", \"Asia/Tokyo\"]. Default [\"UTC\"]."),
    format: format.default("rfc3339").describe("Timestamp format: rfc3339 (default), iso8601 or epoch."),
  }),
  list_timezones: z.strictObject({
    region: z.string().regex(/^[a-zA-Z]{1,32}$/).optional().describe("Only list zones in this region, for example Europe or America."),
  }),
  timezone_info: z.strictObject({ timezone: zone.describe("IANA time zone, for example America/New_York.") }),
  convert_timezone: z.strictObject({
    datetime: datetime.refine(s => /(?:Z|[+-]\d{2}:\d{2})$/.test(s) || !s.includes("."), "may have fractional seconds only with an offset, such as 2026-10-29T15:30:00.5+01:00")
      .describe("Local date and time in the source zone, for example 2026-10-29T15:30:00. Seconds are optional. An offset, such as +01:00, must be the zone's own and settles a time that a daylight-saving change makes ambiguous."),
    from_timezone: zone.describe("IANA zone the datetime is in."),
    to_timezone: zone.describe("IANA zone to convert to."),
  }),
  calendar_query: z.strictObject({ date: date.describe("Date as YYYY-MM-DD, between 1900 and 2100.") }),
  date_arithmetic: z.strictObject({
    date: dateOrTime.describe("Start date (YYYY-MM-DD) or date-time."),
    operation: z.enum(["add", "subtract"]).describe("Whether to add or subtract the amount."),
    amount: integer.min(0).max(100000).describe("How many units to add or subtract."),
    unit: z.enum(["seconds", "minutes", "hours", "days", "weeks", "months", "years"]).describe("Unit of the amount. Month and year steps clamp to the month's last day."),
  }),
  date_diff: z.strictObject({
    from: dateOrTime.describe("Start date (YYYY-MM-DD) or date-time."),
    to: dateOrTime.describe("End date (YYYY-MM-DD) or date-time."),
  }),
  date_format: z.strictObject({
    input: dateOrTime.describe("Date (YYYY-MM-DD) or date-time to reformat."),
    output_format: z.enum(["iso8601", "rfc3339", "rfc2822", "epoch", "unix-timestamp"]).describe("Format to produce."),
  }),
  holidays: z.discriminatedUnion("mode", [
    z.strictObject({
      mode: z.literal("check").describe("check: is one date a public holiday?"),
      date: holidayDate.describe("Date to check as YYYY-MM-DD, between 2000 and 2030."),
      country: holidayCountry,
      region,
    }),
    z.strictObject({
      mode: z.literal("list").describe("list: every public holiday in a year."),
      year: integer.min(2000, COVERAGE).max(2030, COVERAGE).describe("Year to list, 2000-2030."),
      country: holidayCountry,
      region,
    }),
  ]).superRefine(regionNeedsGB),
  business_days: z.discriminatedUnion("mode", [
    z.strictObject({
      mode: z.literal("between").describe("between: count business days from one date to another, both inclusive."),
      from: date.describe("First date as YYYY-MM-DD."),
      to: date.describe("Last date as YYYY-MM-DD, at most 366 days from the first."),
      country: country.optional().describe("ISO country code whose nationwide public holidays to skip as well as weekends. Both dates must then be within 2000-2030."),
      region,
    }),
    z.strictObject({
      mode: z.enum(["next", "prev"]).describe("next or prev: the nearest business day strictly after or before the date."),
      date: date.describe("Date as YYYY-MM-DD."),
      country: country.optional().describe("ISO country code whose nationwide public holidays to skip. The date must be within 2000-2030."),
      region,
    }),
  ]).superRefine((v, ctx) => {
    regionNeedsGB(v, ctx)
    const coverage = (field: "from" | "to" | "date", value: string) => { if (v.country && !covered(value)) ctx.addIssue({ code: "custom", path: [field], message: `${COVERAGE} when country is given; leave out country to count weekends only` }) }
    if (v.mode !== "between") return coverage("date", v.date)
    if (Math.abs(Date.parse(v.to) - Date.parse(v.from)) > 366 * 86400000) ctx.addIssue({ code: "custom", path: ["to"], message: "must be at most 366 days from from" })
    coverage("from", v.from); coverage("to", v.to)
  }),
  timer_set: z.strictObject({
    name,
    deadline: instant.describe("When the timer is due, as a date-time with a zone offset, for example 2026-11-02T09:00:00Z."),
    description: byteText(2048).optional().describe("What the timer is for, up to 2 KB."),
    tags: z.array(tag).max(16).default([]).describe("Up to 16 tags for filtering with utilities_timer_list."),
    replace: z.boolean().default(false).describe("Overwrite a timer with the same name. Default false: an existing name is an error."),
  }),
  timer_get: z.strictObject({ name }),
  timer_list: z.strictObject({ tag: tag.optional().describe("Only list timers with this tag."), ...page }),
  timer_delete: z.strictObject({ name }),
  timer_check: z.strictObject(page),
}
const s = text(), n = integer, b = z.boolean()
const snapshot = z.strictObject({ timezone: s, local_datetime: s, utc_datetime: s, display_datetime: s, utc_offset: s, utc_offset_seconds: n, is_dst: b, abbreviation: s.nullable(), weekday: s, iso_week: n.min(1).max(53), iso_year: n, day_of_year: n.min(1).max(366), unix_epoch: n })
const coverage = z.strictObject({ source: s, start_year: z.literal(2000), end_year: z.literal(2030), runtime_network: z.literal(false) })
const nativeHoliday = z.strictObject({ country_code: s, country: s, date, name: text(512) })
const holiday = nativeHoliday.extend({
  nationwide: b.describe("true when the whole country observes it."),
  regions: z.array(z.enum(GB_REGIONS)).max(GB_REGIONS.length).describe("The nations that observe a regional holiday, such as [\"Scotland\"]; empty when nationwide."),
})
const asked = z.enum(GB_REGIONS).nullable().describe("The region asked for, or null.")
export const timerRecord = z.strictObject({ name: timerName, deadline_utc: s, original_deadline: s, timezone: s, description: byteText(2048).optional(), tags: z.array(tag).max(16), created_at_utc: s, updated_at_utc: s, status: s, overdue: b, remaining_seconds: n, remaining: s })
export const timerList = z.strictObject({ tag: s.optional(), count: n.min(0).max(1000), timers: z.array(timerRecord).max(1000) }).refine(v => v.count === v.timers.length)
export const timerCheck = z.strictObject({ generated_at_utc: s, count: n.min(0).max(1000), timers: z.array(timerRecord).max(1000) }).refine(v => v.count === v.timers.length)
const timerPage = { total: n.min(0).max(1000), count: n.min(0).max(100), nextOffset: n.min(0).max(999).nullable(), timers: z.array(timerRecord).max(100) }
export const timeOutputs = {
  current_time: z.strictObject({ generated_at_utc: s, format: s, times: z.array(snapshot).min(1).max(16) }),
  list_timezones: z.strictObject({ region: s.optional(), count: n.min(0).max(1000), timezones: z.array(s).max(1000) }).refine(v => v.count === v.timezones.length),
  timezone_info: z.strictObject({ timezone: s, current: snapshot, next_transition: z.strictObject({ transition_utc: s, transition_local: s, offset_before: s, offset_before_seconds: n, offset_after: s, offset_after_seconds: n, abbreviation_before: s.nullable(), abbreviation_after: s.nullable() }).nullable() }),
  convert_timezone: z.strictObject({ input_datetime: s, from_timezone: s, to_timezone: s, source: snapshot, target: snapshot }),
  calendar_query: z.strictObject({ date, weekday: s, weekday_number_from_monday: n.min(1).max(7), iso_week: n.min(1).max(53), iso_year: n, day_of_year: n.min(1).max(366), days_in_month: n.min(28).max(31), leap_year: b, quarter: n.min(1).max(4) }),
  date_arithmetic: z.strictObject({ input: s, input_kind: s, operation: s, amount: n, unit: s, result: s, result_kind: s, month_end_clamped: b }),
  date_diff: z.strictObject({ from: s, to: s, from_kind: s, to_kind: s, signed_seconds: n, signed_minutes: n, signed_hours: n, signed_days: n, signed_weeks: n, direction: n, absolute_seconds: n.min(0) }),
  date_format: z.strictObject({ input: s, input_kind: s, output_format: s, formatted: s, timezone_present: b }),
  holidays: z.union([z.strictObject({ date, country_code: s, country: s, region: asked, is_holiday: b, holiday: holiday.optional(), coverage }), z.strictObject({ year: n.min(2000).max(2030), country_code: s, country: s, region: asked, count: n.min(0).max(366), holidays: z.array(holiday).max(366), coverage })]),
  business_days: z.union([
    z.strictObject({ from: date, to: date, inclusive: z.literal(true), direction: n, calendar_days: n, business_days: n, mode: s, country_code: s.nullable(), region: asked, skip_holidays: b, holidays_skipped: z.array(holiday).max(366),
      regional_holidays_not_skipped: z.array(holiday).max(366).describe("Weekday holidays of other regions in the range, which were not skipped."), coverage: coverage.nullable() }),
    z.strictObject({ input_date: date, business_date: date, direction: s, strict: z.literal(true), days_moved: n, mode: s, country_code: s.nullable(), region: asked, coverage: coverage.nullable() }),
  ]),
  timer_set: timerRecord, timer_get: timerRecord, timer_list: z.strictObject({ tag: s.optional(), ...timerPage }).refine(v => v.count === v.timers.length),
  timer_delete: z.strictObject({ name: timerName, deleted: z.literal(true), deleted_tags: n.min(0).max(16) }),
  timer_check: z.strictObject({ generated_at_utc: s, ...timerPage }).refine(v => v.count === v.timers.length),
}
/** What time-keep itself prints, where the tool output adds to it. */
export const timeNative = {
  holidays: z.union([z.strictObject({ date, country_code: s, country: s, is_holiday: b, holiday: nativeHoliday.optional(), coverage }), z.strictObject({ year: n.min(2000).max(2030), country_code: s, country: s, count: n.min(0).max(366), holidays: z.array(nativeHoliday).max(366), coverage })]),
  between: z.strictObject({ from: date, to: date, inclusive: z.literal(true), direction: n, calendar_days: n, business_days: n, mode: s, country_code: s.nullable(), skip_holidays: b, holidays_skipped: z.array(nativeHoliday).max(366), coverage: coverage.nullable() }),
  step: z.strictObject({ input_date: date, business_date: date, direction: s, strict: z.literal(true), days_moved: n, mode: s, country_code: s.nullable(), coverage: coverage.nullable() }),
  list: z.strictObject({ year: n.min(2000).max(2030), country_code: s, country: s, count: n.min(0).max(366), holidays: z.array(nativeHoliday).max(366), coverage }),
}
export type TimeOperation = keyof typeof timeInputs
export type TimerRecord = z.output<typeof timerRecord>
export type TimeInput = { [K in TimeOperation]: z.infer<typeof timeInputs[K]> }
