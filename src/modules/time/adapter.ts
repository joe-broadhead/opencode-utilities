import { lstat, rename, rm, rmdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { timeArgv } from "./argv.js"
import type * as z from "zod"
import { timeNative, timeOutputs, timerList, timerCheck, type TimeInput, type TimeOperation, type TimerRecord } from "./contracts.js"
import { applies, mark, tagged } from "./regions.js"
import { privateDirectory, sqliteFiles } from "../../process/files.js"
import { withLock } from "../../process/lock.js"
import { BackendFailure } from "../../process/run.js"
import { timeFailure } from "./failures.js"
import { LIMITS, parse, fail, fence, zone } from "../../domain/common.js"
import type { AdapterResult } from "../../domain/contract.js"
import type { ModuleContext } from "../context.js"

/** time-keep reports a missing timer as exit 1 with `{ error: { error_code: "INVALID_PARAMS", message: "timer not found: …" } }` on stderr. */
const notFound = (report: unknown) => {
  const error = (report as { error?: { error_code?: unknown; message?: unknown } } | undefined)?.error
  return error?.error_code === "INVALID_PARAMS" && typeof error.message === "string" && error.message.startsWith("timer not found")
}

export async function invoke<K extends TimeOperation>(op: K, input: TimeInput[K], ctx: ModuleContext): Promise<AdapterResult> {
  try {
    const output = op.startsWith("timer_") ? await timers(op, input, ctx)
      : op === "holidays" ? await holidays(input as TimeInput["holidays"], ctx)
      : op === "business_days" ? await businessDays(input as TimeInput["business_days"], ctx)
      : op === "current_time" ? parse(timeOutputs.current_time, { ...await ctx.run(timeArgv(op, input, paths(ctx))) as object, machine_timezone: machineZone() })
      : parse(timeOutputs[op], await ctx.run(timeArgv(op, input, paths(ctx))))
    return { output, text: JSON.stringify(output) }
  } catch (error) {
    // DST gaps and overlaps, coverage and range failures get their own codes; the rest stays BACKEND_FAILED.
    throw error instanceof BackendFailure ? timeFailure(error.report, op, input) ?? error : error
  }
}
/** The plugin process's own zone: its children run with TZ=UTC, so only this process knows it. */
const machineZone = () => { const name = Intl.DateTimeFormat().resolvedOptions().timeZone; return zone.safeParse(name).success ? name : null }
const paths = (ctx: ModuleContext) => ({ config: join(ctx.stage, "empty.toml"), store: ctx.store })

/** Holidays, each marked nationwide or with its regions. With `region`, only the holidays that apply there. */
async function holidays(input: TimeInput["holidays"], ctx: ModuleContext) {
  const native = parse(timeNative.holidays, await ctx.run(timeArgv("holidays", input, paths(ctx)))), region = input.region ?? null
  if ("holidays" in native) {
    const list = native.holidays.map(mark).filter(h => !region || applies(h, region))
    return parse(timeOutputs.holidays, { ...native, region, count: list.length, holidays: list })
  }
  const { holiday: found, ...rest } = native, holiday = found && mark(found)
  // Without a region every holiday in the data counts, as in a list; a region keeps only its own and the nationwide ones.
  const counts = holiday !== undefined && (!region || applies(holiday, region))
  return parse(timeOutputs.holidays, { ...rest, region, is_holiday: counts, ...counts ? { holiday } : {} })
}

/**
 * Business days skip weekends and the nationwide holidays, plus `region`'s own. time-keep skips every holiday in
 * its data, regional ones included, so for a country with regional rows the result is corrected: `between` adds
 * back the regional weekdays it skipped, and next/prev step over weekends with time-keep and over the counted
 * holidays here.
 */
async function businessDays(input: TimeInput["business_days"], ctx: ModuleContext) {
  const region = input.region ?? null
  if (input.mode === "between") {
    const native = parse(timeNative.between, await ctx.run(timeArgv("business_days", input, paths(ctx))))
    const marked = native.holidays_skipped.map(mark), skipped = marked.filter(h => applies(h, input.region)), other = marked.filter(h => !applies(h, input.region))
    // holidays_skipped holds one weekday per date, so each one not skipped is one more business day.
    return parse(timeOutputs.business_days, { ...native, region, business_days: native.business_days + native.direction * other.length, holidays_skipped: skipped, regional_holidays_not_skipped: other })
  }
  if (!input.country || !tagged(input.country)) return parse(timeOutputs.business_days, { ...parse(timeNative.step, await ctx.run(timeArgv("business_days", input, paths(ctx)))), region })
  const country = input.country, counted = new Map<number, ReadonlySet<string>>()
  let coverage: z.output<typeof timeNative.list>["coverage"] | undefined
  const holiday = async (date: string) => {
    const year = Number(date.slice(0, 4))
    if (!counted.has(year)) {
      // A year outside 2000-2030 fails here as time-keep's own coverage error, which becomes HOLIDAY_COVERAGE.
      const list = parse(timeNative.list, await ctx.run(timeArgv("holidays", { mode: "list", year, country }, paths(ctx))))
      counted.set(year, new Set(list.holidays.map(mark).filter(h => applies(h, input.region)).map(h => h.date))); coverage = list.coverage
    }
    return counted.get(year)!.has(date)
  }
  let date = input.date
  // Weekends come from time-keep (weekend_only); holidays rarely run more than a few days, so the bound is generous.
  for (let steps = 0; steps < 31; steps++) {
    const step = parse(timeNative.step, await ctx.run(timeArgv("business_days", { mode: input.mode, date }, paths(ctx))))
    date = step.business_date
    if (!await holiday(date)) {
      const days = Math.abs(Date.parse(date) - Date.parse(input.date)) / 86400000
      return parse(timeOutputs.business_days, { ...step, input_date: input.date, days_moved: days, mode: "country_holidays", country_code: country, region, coverage: coverage ?? null })
    }
  }
  return fail("HOLIDAY_COVERAGE")
}

async function timers<K extends TimeOperation>(op: K, input: TimeInput[K], ctx: ModuleContext) {
  // Timers are serialized across host processes; SQLite files are inspected before every spawn.
  const run = async (args: string[], mutation = false) => { await sqliteFiles(ctx.store); fence(ctx.signal); return ctx.run(args, { mutation }) }
  await privateDirectory(ctx.store); fence(ctx.signal)
  return withLock(join(ctx.store, ".utilities-lock"), ctx.signal, async () => {
    await migrate(ctx, run); fence(ctx.signal)
    if (op === "timer_set") {
      const i = input as TimeInput["timer_set"]
      const existing = parse(timerList, await run(timeArgv("timer_list", { offset: 0, limit: 20 }, paths(ctx))))
      const found = existing.timers.some(t => t.name === i.name)
      if (found && !i.replace) fail("TIMER_EXISTS", { message: `A timer named '${i.name}' already exists in this project.` })
      if (!found && existing.count >= LIMITS.timers) fail("TIMER_QUOTA")
      // Bound the CLI's unpaginated all-row serialization, including pretty-print overhead.
      const storeBytes = existing.timers.filter(t => t.name !== i.name).reduce((n, t) => n + Buffer.byteLength(JSON.stringify(t)) + 384, 0)
      if (storeBytes + Buffer.byteLength(JSON.stringify(i)) + 1024 > 768 * 1024) fail("TIMER_BYTE_QUOTA")
    }
    fence(ctx.signal)
    let output: unknown
    try { output = await run(timeArgv(op, input, paths(ctx)), op === "timer_set" || op === "timer_delete") }
    catch (error) {
      if (error instanceof BackendFailure && notFound(error.report)) fail("TIMER_NOT_FOUND", { message: `No timer named '${(input as TimeInput["timer_get"]).name}' exists in this project.` })
      throw error
    }
    if (op !== "timer_list" && op !== "timer_check") return parse(timeOutputs[op], output)
    const value = parse(op === "timer_list" ? timerList : timerCheck, output), page = input as TimeInput["timer_list" | "timer_check"]
    const timers = []
    let bytes = 512
    for (const timer of value.timers.slice(page.offset, page.offset + page.limit)) {
      const size = Buffer.byteLength(JSON.stringify(timer)) + 1
      if (bytes + size > 60000) break
      bytes += size; timers.push(timer)
    }
    const end = page.offset + timers.length
    return { ...value, total: value.count, count: timers.length, timers, nextOffset: end < value.count ? end : null }
  })
}

const SQLITE = ["timers.db", "timers.db-wal", "timers.db-shm", "timers.db-journal"] as const
const present = async (store: string) => (await Promise.all(SQLITE.map(file => lstat(join(store, file)).then(() => file, () => undefined)))).filter(file => file !== undefined)
const sameTimer = (a: TimerRecord, b: TimerRecord) => a.deadline_utc === b.deadline_utc && a.description === b.description && JSON.stringify([...a.tags].sort()) === JSON.stringify([...b.tags].sort())
/** `name (2)`, `name (3)` …: the first name the project store does not use, within the 128-character limit. */
function freeName(name: string, taken: ReadonlySet<string>) {
  for (let n = 2; ; n++) { const suffix = ` (${n})`, candidate = `${name.slice(0, 128 - suffix.length).trimEnd()}${suffix}`; if (!taken.has(candidate)) return candidate }
}

/**
 * Moves 0.0.1's per-directory stores of this project into the project store. Runs under the project store's lock,
 * and takes each old store's lock too, since a 0.0.1 process may still use it. An old store moves whole (its one
 * SQLite file renamed, every field kept) while the project store is empty; otherwise each timer is copied with
 * time-keep, an identical one is skipped, and a different one with a taken name gets `name (2)`. Copies are
 * idempotent, so a move cut short repeats safely; the old files go only after every timer is in.
 */
async function migrate(ctx: ModuleContext, run: (args: string[], mutation?: boolean) => Promise<unknown>) {
  const at = (store: string) => ({ config: join(ctx.stage, "empty.toml"), store })
  for (const legacy of ctx.legacyStores) {
    if (!await lstat(legacy).then(info => info.isDirectory(), () => false)) continue
    await withLock(join(legacy, ".utilities-lock"), ctx.signal, async () => {
      await sqliteFiles(legacy)
      const files = await present(legacy)
      if (!files.includes("timers.db")) return
      if (files.length === 1 && (await present(ctx.store)).length === 0) { await rename(join(legacy, "timers.db"), join(ctx.store, "timers.db")); return }
      const old = parse(timerList, await run(timeArgv("timer_list", { offset: 0, limit: 20 }, at(legacy))))
      const current = parse(timerList, await run(timeArgv("timer_list", { offset: 0, limit: 20 }, at(ctx.store))))
      const taken = new Set(current.timers.map(t => t.name))
      for (const timer of old.timers) {
        fence(ctx.signal)
        const existing = current.timers.find(t => t.name === timer.name)
        if (existing && sameTimer(existing, timer)) continue
        // A full project store keeps the rest in the old store, still on disk; the next call tries again.
        if (taken.size >= LIMITS.timers) return
        const name = existing ? freeName(timer.name, taken) : timer.name
        await run(timeArgv("timer_set", { name, deadline: timer.original_deadline, ...timer.description === undefined ? {} : { description: timer.description }, tags: timer.tags, replace: false }, at(ctx.store)))
        taken.add(name)
      }
      for (const file of files) await rm(join(legacy, file), { force: true })
    })
    // Only empty folders go; anything else in them stays.
    await rmdir(legacy).then(() => rmdir(dirname(legacy))).catch(() => undefined)
  }
}
