import type { TimeOperation, TimeInput } from "./contracts.js"

// All options precede --. User-controlled positional values cannot become flags.
export function timeArgv<K extends TimeOperation>(operation: K, input: TimeInput[K], paths: { config: string; store: string }): string[] {
  const base = ["--output=json", `--config=${paths.config}`, `--data-dir=${paths.store}`]
  const v = input as TimeInput[TimeOperation]
  let args: string[]
  switch (operation) {
    case "current_time": { const i = v as TimeInput["current_time"]; args = ["now", `--format=${i.format}`, ...i.timezones.map(t => `--tz=${t}`)]; break }
    case "list_timezones": { const i = v as TimeInput["list_timezones"]; args = ["tz", "list", ...(i.region ? [`--region=${i.region}`] : [])]; break }
    case "timezone_info": args = ["tz", "info", "--", (v as TimeInput["timezone_info"]).timezone]; break
    case "convert_timezone": { const i = v as TimeInput["convert_timezone"]; args = ["convert", `--from=${i.from_timezone}`, `--to=${i.to_timezone}`, "--", i.datetime]; break }
    case "calendar_query": args = ["calendar", "--", (v as TimeInput["calendar_query"]).date]; break
    case "date_arithmetic": { const i = v as TimeInput["date_arithmetic"]; args = ["calc", i.operation, "--", i.date, String(i.amount), i.unit]; break }
    case "date_diff": { const i = v as TimeInput["date_diff"]; args = ["calc", "diff", "--", i.from, i.to]; break }
    case "date_format": { const i = v as TimeInput["date_format"]; args = ["format", `--output-format=${i.output_format}`, "--", i.input]; break }
    case "holidays": { const i = v as TimeInput["holidays"]; args = ["holiday", i.mode, `--country=${i.country}`, "--", i.mode === "check" ? i.date : String(i.year)]; break }
    case "business_days": { const i = v as TimeInput["business_days"]; args = ["biz", i.mode, ...(i.country ? [`--country=${i.country}`] : []), ...(i.mode === "between" && i.country ? ["--skip-holidays"] : []), "--", ...(i.mode === "between" ? [i.from, i.to] : [i.date])]; break }
    case "timer_set": { const i = v as TimeInput["timer_set"]; args = ["timer", "set", ...(i.description === undefined ? [] : [`--description=${i.description}`]), ...i.tags.map(t => `--tag=${t}`), "--", i.name, i.deadline]; break }
    case "timer_get": case "timer_delete": args = ["timer", operation.slice(6), "--", (v as TimeInput["timer_get"]).name]; break
    case "timer_list": { const i = v as TimeInput["timer_list"]; args = ["timer", "list", ...(i.tag ? [`--tag=${i.tag}`] : [])]; break }
    case "timer_check": args = ["timer", "check"]; break
    default: return operation satisfies never
  }
  return [...base, ...args]
}
