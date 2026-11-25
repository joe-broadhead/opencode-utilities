import type { HandlerTable } from "@we-the-rebel-alliance/plugin-contract/register"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { Provider } from "../provider/index.js"
import { diagnose } from "./diagnose.js"
import { nativeInstall } from "./native_install.js"
import { sessions } from "./sessions.js"
import { sessionsGrep } from "./sessions_grep.js"
import { speechInstall } from "./speech_install.js"
import { status } from "./status.js"
import { timeAdd } from "./time_add.js"
import { timeBetween } from "./time_between.js"
import { timeBusinessDays } from "./time_business_days.js"
import { timeCalendar } from "./time_calendar.js"
import { timeConvert } from "./time_convert.js"
import { timeFormat } from "./time_format.js"
import { timeHolidays } from "./time_holidays.js"
import { timeNow } from "./time_now.js"
import { timeZoneInfo } from "./time_zone_info.js"
import { timeZones } from "./time_zones.js"
import { timerCheck } from "./timer_check.js"
import { timerDelete } from "./timer_delete.js"
import { timerGet } from "./timer_get.js"
import { timerList } from "./timer_list.js"
import { timerSet } from "./timer_set.js"
import { weatherCurrent } from "./weather_current.js"
import { weatherDaily } from "./weather_daily.js"
import { weatherDemandSignal } from "./weather_demand_signal.js"
import { weatherGeocode } from "./weather_geocode.js"
import { weatherHourly } from "./weather_hourly.js"
import { weatherSummary } from "./weather_summary.js"
import { speechSynthesize } from "./speech_synthesize.js"
import { speechTranscribe } from "./speech_transcribe.js"

export interface HandlerDeps {
  readonly provider: Provider
  readonly manifest: Manifest
  readonly version: string
  readonly hostVersion: string
  readonly access: "all" | "ask-changes" | "read-only"
  /** What setup could not finish, such as a skill file that was skipped; status and diagnose report it. */
  readonly skillProblems: readonly string[]
}

/**
 * One handler per declared method, by the method's name. The register refuses a declared method with no handler and a
 * handler the manifest does not declare, so this table and `capabilities.methods` cannot drift.
 */
export function createHandlers(deps: HandlerDeps): HandlerTable {
  const { provider, manifest } = deps
  return {
    status: status({ manifest, version: deps.version, hostVersion: deps.hostVersion, problems: deps.skillProblems }),
    diagnose: diagnose({
      provider, version: deps.version, hostVersion: deps.hostVersion,
      range: manifest.plugin.host.opencode, tested: manifest.plugin.host.tested, access: deps.access, problems: deps.skillProblems,
    }),
    sessions: sessions(provider),
    sessions_grep: sessionsGrep(provider),
    time_now: timeNow(provider),
    time_zones: timeZones(provider),
    time_zone_info: timeZoneInfo(provider),
    time_convert: timeConvert(provider),
    time_calendar: timeCalendar(provider),
    time_add: timeAdd(provider),
    time_between: timeBetween(provider),
    time_format: timeFormat(provider),
    time_holidays: timeHolidays(provider),
    time_business_days: timeBusinessDays(provider),
    timer_set: timerSet(provider),
    timer_get: timerGet(provider),
    timer_list: timerList(provider),
    timer_check: timerCheck(provider),
    timer_delete: timerDelete(provider),
    native_install: nativeInstall(provider),
    weather_geocode: weatherGeocode(provider),
    weather_current: weatherCurrent(provider),
    weather_daily: weatherDaily(provider),
    weather_hourly: weatherHourly(provider),
    weather_demand_signal: weatherDemandSignal(provider),
    weather_summary: weatherSummary(provider),
    speech_transcribe: speechTranscribe(provider),
    speech_synthesize: speechSynthesize(provider),
    speech_install: speechInstall(provider),
  }
}
