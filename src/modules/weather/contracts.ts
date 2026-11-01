import * as z from "zod"
import { text, finite, integer } from "../../domain/common.js"
import { WEATHER_ATTRIBUTION, type GeocodeOutput, type WeatherOutput } from "../../domain/contract.js"

const country = z.string().regex(/^[A-Z]{2}$/).optional().describe("ISO 3166-1 alpha-2 country code that narrows the place search, for example GB.")
const location = text(256).trim().min(1).describe("Place name, for example \"Cape Town\", or coordinates as \"latitude,longitude\", for example \"-33.92,18.42\".")
const days = integer.min(1).max(16).default(7).describe("Number of days to forecast, 1-16. Default 7.")
export const weatherInputs = {
  geocode: z.strictObject({
    query: text(256).trim().min(1).describe("Place name to look up, for example \"Springfield\"."),
    country,
    count: integer.min(1).max(10).default(5).describe("Maximum matches to return, 1-10. Default 5."),
  }),
  current: z.strictObject({ location, country }),
  daily: z.strictObject({ location, country, days }),
  hourly: z.strictObject({ location, country, hours: integer.min(1).max(384).default(48).describe("Number of hours to forecast, 1-384. Default 48.") }),
  demand_signal: z.strictObject({ location, country, days }),
  summary: z.strictObject({ location, country, days }),
}
export const locationOutput = z.strictObject({ id: integer.nullable(), name: text(), country: text().nullable(), country_code: text(2).nullable(), admin1: text().nullable(), latitude: finite.min(-90).max(90), longitude: finite.min(-180).max(180), timezone: text(80).nullable(), population: integer.nonnegative().nullable() })
const base = { source: z.literal("open-meteo"), location: locationOutput, fetched_at: text(80), cache: z.enum(["hit", "miss", "refresh"]), timezone: text(80) }
export const CURRENT_UNITS = { temperature_2m: "°C", relative_humidity_2m: "%", apparent_temperature: "°C", precipitation: "mm", rain: "mm", showers: "mm", snowfall: "cm", weather_code: "WMO code", cloud_cover: "%", wind_speed_10m: "km/h", wind_gusts_10m: "km/h" }
export const HOURLY_UNITS = { temperature_2m: "°C", apparent_temperature: "°C", precipitation_probability: "%", precipitation: "mm", rain: "mm", weather_code: "WMO code", cloud_cover: "%", wind_speed_10m: "km/h", wind_gusts_10m: "km/h", is_day: "boolean 0/1" }
export const DAILY_UNITS = { weather_code: "WMO code", temperature_2m_max: "°C", temperature_2m_min: "°C", apparent_temperature_max: "°C", apparent_temperature_min: "°C", precipitation_sum: "mm", precipitation_hours: "h", precipitation_probability_max: "%", wind_speed_10m_max: "km/h", wind_gusts_10m_max: "km/h", sunshine_duration: "s", uv_index_max: "index" }
const measurements = (units: Record<string, string>) => Object.fromEntries(Object.keys(units).map(k => [k, finite.nullable()]))
const series = (units: Record<string, string>, max: number) => z.strictObject({ time: z.array(text(40)).max(max), ...Object.fromEntries(Object.keys(units).map(k => [k, z.array(finite.nullable()).max(max)])) }).refine(v => Object.values(v).every(a => a.length === v.time.length))
const signal = z.strictObject({ date: text(10), ...measurements({ temp_max_c: "", temp_min_c: "", apparent_temp_max_c: "", apparent_temp_min_c: "", precipitation_mm: "", precip_probability_max_pct: "", precipitation_hours: "", wind_speed_max_kmh: "", wind_gust_max_kmh: "", sunshine_hours: "", uv_index_max: "", weather_code: "" }), flags: z.strictObject(Object.fromEntries(["rain_likely", "wet_day", "heavy_rain", "warm_day", "hot_day", "cold_day", "windy_day", "sunny_day", "high_uv"].map(k => [k, z.boolean()]))) })
const signals = { ...base, profile: z.literal("demand"), days: z.array(signal).max(16) }
const summary = { ...signals, headline: text(512), total_days: integer.min(0).max(16), risk_days: integer.min(0).max(16), warm_days: integer.min(0).max(16), hot_days: integer.min(0).max(16), wet_days: integer.min(0).max(16), windy_days: integer.min(0).max(16), sunny_days: integer.min(0).max(16) }
const summaryCounts = (v: z.infer<z.ZodObject<typeof summary>>) => v.total_days === v.days.length && [v.risk_days, v.warm_days, v.hot_days, v.wet_days, v.windy_days, v.sunny_days].every(n => n <= v.total_days)
/** What the weather-signal CLI prints. */
export const weatherNativeOutputs = {
  geocode: z.array(locationOutput).max(10),
  current: z.strictObject({ ...base, current: z.strictObject({ time: text(40), interval: integer.nonnegative(), ...measurements(CURRENT_UNITS) }) }),
  daily: z.strictObject({ ...base, daily: series(DAILY_UNITS, 16) }),
  hourly: z.strictObject({ ...base, hourly: series(HOURLY_UNITS, 384) }),
  demand_signal: z.strictObject(signals),
  summary: z.strictObject(summary).refine(summaryCounts),
}
const units = z.record(text(80), text(32))
const attribution = z.literal(WEATHER_ATTRIBUTION)
/** What the weather tools return: every output carries the Open-Meteo attribution. */
export const weatherOutputs = {
  geocode: z.strictObject({ locations: weatherNativeOutputs.geocode, attribution }) satisfies z.ZodType<GeocodeOutput<z.infer<typeof locationOutput>>>,
  current: weatherNativeOutputs.current.extend({ units, attribution }) satisfies z.ZodType<WeatherOutput<object>>,
  daily: weatherNativeOutputs.daily.extend({ units, attribution }) satisfies z.ZodType<WeatherOutput<object>>,
  hourly: weatherNativeOutputs.hourly.extend({ units, attribution }) satisfies z.ZodType<WeatherOutput<object>>,
  demand_signal: weatherNativeOutputs.demand_signal.extend({ attribution }) satisfies z.ZodType<WeatherOutput<object>>,
  summary: z.strictObject({ ...summary, attribution }).refine(summaryCounts) satisfies z.ZodType<WeatherOutput<object>>,
}
export type WeatherOperation = keyof typeof weatherInputs
export type WeatherInput = { [K in WeatherOperation]: z.infer<typeof weatherInputs[K]> }
