import type { z } from "zod"
import { join } from "node:path"
import { weatherArgv } from "./argv.js"
import { weatherNativeOutputs, CURRENT_UNITS, DAILY_UNITS, HOURLY_UNITS, type WeatherInput, type WeatherOperation } from "./contracts.js"
import { BackendFailure } from "../../process/run.js"
import { parse, fail, UtilitiesError } from "../../domain/common.js"
import { WEATHER_ATTRIBUTION, type AdapterResult } from "../../domain/contract.js"
import type { ModuleContext } from "../context.js"

const UNITS = { current: CURRENT_UNITS, daily: DAILY_UNITS, hourly: HOURLY_UNITS } as const

export async function invoke(op: WeatherOperation, input: WeatherInput[WeatherOperation], ctx: ModuleContext, commercial: boolean): Promise<AdapterResult> {
  let raw: unknown
  try { raw = await ctx.run(weatherArgv(op, input, join(ctx.stage, "empty.toml"), commercial)) }
  catch (error) { throw error instanceof BackendFailure ? failure(error.report, commercial) : error }
  const native: z.output<typeof weatherNativeOutputs[WeatherOperation]> = parse(weatherNativeOutputs[op], raw), i = input
  if (Array.isArray(native)) {
    if ("count" in i && native.length > i.count) fail("CONTRACT_MISMATCH")
    return result({ locations: native, attribution: WEATHER_ATTRIBUTION })
  }
  if ("days" in native && "days" in i && native.days.length > i.days) fail("CONTRACT_MISMATCH")
  if ("daily" in native && "days" in i && native.daily.time.length > i.days) fail("CONTRACT_MISMATCH")
  if ("hourly" in native && "hours" in i && native.hourly.time.length > i.hours) fail("CONTRACT_MISMATCH")
  const units = op === "current" || op === "daily" || op === "hourly" ? { units: UNITS[op] } : {}
  return result({ ...native, ...units, attribution: WEATHER_ATTRIBUTION })
}
const result = (output: object): AdapterResult => ({ output, text: `${JSON.stringify(output)}\n${WEATHER_ATTRIBUTION}.` })

/** weather-signal reports failures as `{ error, causes }` on stderr. These may contain the location, so only patterns are read. */
function failure(report: unknown, commercial: boolean) {
  const { error, causes } = (report ?? {}) as { error?: unknown; causes?: unknown }
  const text = [error, ...Array.isArray(causes) ? causes : []].filter(v => typeof v === "string").join("\n")
  if (commercial && /\bstatus (?:401|403)\b/.test(text)) return new UtilitiesError("WEATHER_KEY_REJECTED")
  if (/\bstatus 429\b/.test(text)) return new UtilitiesError("BACKEND_FAILED", { message: "Open-Meteo's rate limit was reached.", hint: commercial ? "Wait a moment and retry." : "Wait and retry. The free tier allows 10,000 calls a day; for more, run /connect and choose Open-Meteo to add a commercial key." })
  if (/^no geocoding result/m.test(text)) return new UtilitiesError("BACKEND_FAILED", { message: "Open-Meteo found no place with that name.", hint: "Check the spelling, add a country code, call utilities_weather_geocode, or pass coordinates as \"lat,lon\"." })
  return new UtilitiesError("BACKEND_FAILED", { message: "The Open-Meteo request failed.", hint: "Check the network and retry." })
}
