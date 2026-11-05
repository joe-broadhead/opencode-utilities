// Schema-valid outputs for every tool, used by the fake runtime. test/unit/contracts.test.ts parses each one.
import { WEATHER_ATTRIBUTION, type ToolName } from "../../src/domain/contract.js"
import { CURRENT_UNITS, DAILY_UNITS, HOURLY_UNITS } from "../../src/modules/weather/contracts.js"

const attribution = WEATHER_ATTRIBUTION
const snapshot = { timezone: "Asia/Tokyo", local_datetime: "2026-10-30T21:00:00+09:00", utc_datetime: "2026-10-30T12:00:00Z", display_datetime: "Fri 30 Oct 2026 21:00 JST", utc_offset: "+09:00", utc_offset_seconds: 32400, is_dst: false, abbreviation: "JST", weekday: "Friday", iso_week: 44, iso_year: 2026, day_of_year: 303, unix_epoch: 1793361600 }
const coverage = { source: "offline", start_year: 2000, end_year: 2030, runtime_network: false }
const timer = { name: "review", deadline_utc: "2026-11-02T09:00:00Z", original_deadline: "2026-11-02T09:00:00Z", timezone: "UTC", tags: [], created_at_utc: "2026-10-30T12:00:00Z", updated_at_utc: "2026-10-30T12:00:00Z", status: "pending", overdue: false, remaining_seconds: 248400, remaining: "2d 21h" }
const place = { id: 1, name: "Amsterdam", country: "Netherlands", country_code: "NL", admin1: "North Holland", latitude: 52.37, longitude: 4.89, timezone: "Europe/Amsterdam", population: 872680 }
const base = { source: "open-meteo", location: place, fetched_at: "2026-10-30T12:00:00Z", cache: "miss", timezone: "Europe/Amsterdam" }
const series = (units: Record<string, string>, time: string) => ({ time: [time], ...Object.fromEntries(Object.keys(units).map(k => [k, [1]])) })
const flags = Object.fromEntries(["rain_likely", "wet_day", "heavy_rain", "warm_day", "hot_day", "cold_day", "windy_day", "sunny_day", "high_uv"].map(k => [k, false]))
const day = { date: "2026-10-30", ...Object.fromEntries(["temp_max_c", "temp_min_c", "apparent_temp_max_c", "apparent_temp_min_c", "precipitation_mm", "precip_probability_max_pct", "precipitation_hours", "wind_speed_max_kmh", "wind_gust_max_kmh", "sunshine_hours", "uv_index_max", "weather_code"].map(k => [k, 1])), flags }
const signals = { ...base, profile: "demand", days: [day] }

/** A valid input for every tool. */
export const INPUTS: { readonly [K in ToolName]: object } = {
  status: {},
  time_now: { timezones: ["Asia/Tokyo"] },
  time_zones: { region: "Asia" },
  time_zone_info: { timezone: "Asia/Tokyo" },
  time_convert: { datetime: "2026-10-30T12:00:00", from_timezone: "UTC", to_timezone: "Asia/Tokyo" },
  time_calendar: { date: "2026-10-30" },
  time_add: { date: "2026-01-31", operation: "add", amount: 1, unit: "months" },
  time_between: { from: "2026-01-01", to: "2026-01-02" },
  time_format: { input: "2026-01-01", output_format: "epoch" },
  time_holidays: { mode: "check", date: "2026-12-25", country: "GB" },
  time_business_days: { mode: "next", date: "2026-10-30" },
  timer_set: { name: "review", deadline: "2026-11-02T09:00:00Z" },
  timer_get: { name: "review" },
  timer_list: {},
  timer_check: {},
  timer_delete: { name: "review" },
  weather_geocode: { query: "Amsterdam" },
  weather_current: { location: "Amsterdam" },
  weather_daily: { location: "Amsterdam", days: 1 },
  weather_hourly: { location: "Amsterdam", hours: 1 },
  weather_demand_signal: { location: "Amsterdam", days: 1 },
  weather_summary: { location: "Amsterdam", days: 1 },
  speech_transcribe: { path: "clip.wav" },
  speech_synthesize: { text: "hello", path: "out.wav" },
}

export const SAMPLES: { readonly [K in Exclude<ToolName, "status">]: { readonly output: unknown; readonly text: string } } = {
  time_now: { output: { generated_at_utc: "2026-10-30T12:00:00Z", format: "rfc3339", times: [snapshot], machine_timezone: "Europe/London" }, text: "It is 21:00 in Asia/Tokyo." },
  time_zones: { output: { region: "Asia", count: 1, timezones: ["Asia/Tokyo"] }, text: "1 zone." },
  time_zone_info: { output: { timezone: "Asia/Tokyo", current: snapshot, next_transition: null }, text: "Asia/Tokyo is UTC+09:00." },
  time_convert: { output: { input_datetime: "2026-10-30T12:00:00", from_timezone: "UTC", to_timezone: "Asia/Tokyo", source: snapshot, target: snapshot }, text: "21:00 in Asia/Tokyo." },
  time_calendar: { output: { date: "2026-10-30", weekday: "Friday", weekday_number_from_monday: 5, iso_week: 44, iso_year: 2026, day_of_year: 303, days_in_month: 31, leap_year: false, quarter: 4 }, text: "Friday, week 44." },
  time_add: { output: { input: "2026-01-31", input_kind: "date", operation: "add", amount: 1, unit: "months", result: "2026-02-28", result_kind: "date", month_end_clamped: true }, text: "2026-02-28." },
  time_between: { output: { from: "2026-01-01", to: "2026-01-02", from_kind: "date", to_kind: "date", signed_seconds: 86400, signed_minutes: 1440, signed_hours: 24, signed_days: 1, signed_weeks: 0, direction: 1, absolute_seconds: 86400 }, text: "1 day." },
  time_format: { output: { input: "2026-01-01", input_kind: "date", output_format: "epoch", formatted: "1767225600", timezone_present: false }, text: "1767225600." },
  time_holidays: { output: { date: "2026-12-25", country_code: "GB", country: "United Kingdom", region: null, is_holiday: true, holiday: { country_code: "GB", country: "United Kingdom", date: "2026-12-25", name: "Christmas Day", nationwide: true, regions: [] }, coverage }, text: "Christmas Day." },
  time_business_days: { output: { input_date: "2026-10-30", business_date: "2026-11-02", direction: "next", strict: true, days_moved: 3, mode: "next", country_code: null, region: null, coverage: null }, text: "2026-11-02." },
  timer_set: { output: timer, text: "Timer review is due 2026-11-02T09:00:00Z." },
  timer_get: { output: timer, text: "Timer review is due in 2d 21h." },
  timer_list: { output: { total: 1, count: 1, nextOffset: null, timers: [timer] }, text: "1 timer." },
  timer_check: { output: { generated_at_utc: "2026-10-30T12:00:00Z", total: 1, count: 1, nextOffset: null, timers: [timer] }, text: "No timers are due." },
  timer_delete: { output: { name: "review", deleted: true, deleted_tags: 0 }, text: "Deleted timer review." },
  weather_geocode: { output: { locations: [place], attribution }, text: `1 place. ${attribution}` },
  weather_current: { output: { ...base, current: { time: "2026-10-30T12:00", interval: 900, ...Object.fromEntries(Object.keys(CURRENT_UNITS).map(k => [k, null])) }, units: CURRENT_UNITS, attribution }, text: `Now in Amsterdam. ${attribution}` },
  weather_daily: { output: { ...base, daily: series(DAILY_UNITS, "2026-10-30"), units: DAILY_UNITS, attribution }, text: `1 day. ${attribution}` },
  weather_hourly: { output: { ...base, hourly: series(HOURLY_UNITS, "2026-10-30T12:00"), units: HOURLY_UNITS, attribution }, text: `1 hour. ${attribution}` },
  weather_demand_signal: { output: { ...signals, attribution }, text: `1 day. ${attribution}` },
  weather_summary: { output: { ...signals, headline: "Mild", total_days: 1, risk_days: 0, warm_days: 0, hot_days: 0, wet_days: 0, windy_days: 0, sunny_days: 0, attribution }, text: `Mild. ${attribution}` },
  speech_transcribe: { output: { schema_version: 2, text: "hello", language: "en", model: "tiny-q5_1", provider: "local", duration_secs: 0.1, backend_kind: "asr", timestamps_reliable: true, cleanup_style: "raw", segments: [{ start: 0, end: 0.1, text: "hello", timestamp_source: "native_model" }] }, text: "hello" },
  speech_synthesize: { output: { path: "/synthetic/speech/out.wav", bytes: 3244, sha256: "a".repeat(64), durationMs: 100, sampleRateHz: 24000, channels: 1, voice: "Luna" }, text: "Saved 0.1 s of speech to /synthetic/speech/out.wav." },
}
