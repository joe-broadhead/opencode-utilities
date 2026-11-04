import { UtilitiesError } from "../../domain/common.js"
import { withSeconds } from "./argv.js"
import type { TimeInput, TimeOperation } from "./contracts.js"

/**
 * time-keep reports bad or uncovered input as exit 1 with `{ error: { error_code: "INVALID_PARAMS", message,
 * details } }` on stderr. Known messages become their own codes, matched by prefix. The text is fixed: it holds
 * only values the schemas already validated (a zone name, UTC instants and offsets), never free text.
 * Anything else stays BACKEND_FAILED.
 */
export function timeFailure(report: unknown, op: TimeOperation, input: TimeInput[TimeOperation]): UtilitiesError | undefined {
  const error = (report as { error?: { error_code?: unknown; message?: unknown; details?: unknown } } | undefined)?.error
  if (error?.error_code !== "INVALID_PARAMS" || typeof error.message !== "string") return undefined
  const message = error.message, details = (typeof error.details === "object" && error.details !== null ? error.details : {}) as Record<string, unknown>
  const zone = op === "convert_timezone" ? (input as TimeInput["convert_timezone"]).from_timezone : undefined
  if (zone && message.startsWith("nonexistent local datetime")) return new UtilitiesError("TIME_NONEXISTENT", { message: `That local time is skipped by a daylight-saving change in ${zone}, so it does not exist there.` })
  if (zone && message.startsWith("ambiguous local datetime")) {
    const local = Date.parse(`${withSeconds((input as TimeInput["convert_timezone"]).datetime).replace(" ", "T").slice(0, 19)}Z`)
    const earliest = instant(details.earliest_utc), latest = instant(details.latest_utc)
    if (earliest === undefined || latest === undefined || !Number.isFinite(local)) return new UtilitiesError("TIME_AMBIGUOUS", { message: `That local time happens twice in ${zone}, at a daylight-saving change.` })
    const first = offset((local - Date.parse(earliest)) / 1000), second = offset((local - Date.parse(latest)) / 1000)
    return new UtilitiesError("TIME_AMBIGUOUS", {
      message: `That local time happens twice in ${zone}, at a daylight-saving change: first at UTC${first} (${earliest}), then at UTC${second} (${latest}).`,
      hint: `Add the offset the user means to the datetime (${first} or ${second}), or ask the user which one they mean.`,
    })
  }
  if (zone && message.startsWith("datetime offset does not match source timezone")) {
    const seconds = details.timezone_offset_seconds
    const used = typeof seconds === "number" && Number.isSafeInteger(seconds) && Math.abs(seconds) < 86400 ? ` (UTC${offset(seconds)})` : ""
    return new UtilitiesError("TIME_OFFSET_MISMATCH", { message: `The datetime's UTC offset is not the one ${zone} uses at that moment${used}.` })
  }
  if (message.startsWith("holiday data supports years") || message.startsWith("holiday year is outside supported coverage") || message.startsWith("could not find a business day inside supported range")) return new UtilitiesError("HOLIDAY_COVERAGE")
  if (/^(?:rfc3339 output supports years|rfc2822 output supports years|date arithmetic overflowed|deadline is outside the supported timestamp range|business-day holiday count overflowed)/.test(message)) return new UtilitiesError("TIME_OUT_OF_RANGE")
  if (message.startsWith("datetime must be RFC3339") || message.startsWith("invalid ISO")) return new UtilitiesError("INPUT_INVALID", { message: "The tool input is invalid. Give dates as YYYY-MM-DD and date-times with seconds, such as 2026-10-29T15:30:00." })
  return undefined
}
const instant = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined
/** `+02:00` for 7200 seconds. */
function offset(seconds: number) {
  const sign = seconds < 0 ? "-" : "+", minutes = Math.round(Math.abs(seconds) / 60)
  return `${sign}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`
}
