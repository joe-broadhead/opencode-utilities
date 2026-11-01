import type { WeatherInput, WeatherOperation } from "./contracts.js"

/**
 * Open-Meteo endpoints. Commercial keys only work on the `customer-` hosts. Every URL is passed explicitly, including
 * the unused historical archive, so the CLI can never fall back to a default or environment-provided endpoint.
 */
const ENDPOINTS = {
  free: { forecast: "https://api.open-meteo.com/v1/forecast", geocode: "https://geocoding-api.open-meteo.com/v1/search", historical: "https://archive-api.open-meteo.com/v1/archive" },
  commercial: { forecast: "https://customer-api.open-meteo.com/v1/forecast", geocode: "https://customer-geocoding-api.open-meteo.com/v1/search", historical: "https://customer-archive-api.open-meteo.com/v1/archive" },
} as const
/** The hosts a call contacts: geocoding alone, or geocoding plus the forecast. */
export const weatherHosts = (op: WeatherOperation, commercial: boolean) => {
  const urls = ENDPOINTS[commercial ? "commercial" : "free"]
  return (op === "geocode" ? [urls.geocode] : [urls.forecast, urls.geocode]).map(url => new URL(url).host)
}
export function weatherArgv<K extends WeatherOperation>(op: K, input: WeatherInput[K], config: string, commercial = false) {
  const i = input as WeatherInput[WeatherOperation], urls = ENDPOINTS[commercial ? "commercial" : "free"]
  const args = ["--output=json", `--config=${config}`, "--timeout=10s", `--forecast-base-url=${urls.forecast}`, `--geocode-base-url=${urls.geocode}`, `--historical-base-url=${urls.historical}`, op === "demand_signal" ? "signal" : op]
  if (i.country) args.push(`--country=${i.country}`)
  if ("count" in i) args.push(`--count=${i.count}`)
  if ("days" in i) args.push(`--days=${i.days}`)
  if ("hours" in i) args.push(`--hours=${i.hours}`)
  if (op === "demand_signal" || op === "summary") args.push("--profile=demand")
  return [...args, "--", "query" in i ? i.query : i.location]
}
