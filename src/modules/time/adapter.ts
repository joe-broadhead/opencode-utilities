import { join } from "node:path"
import { timeArgv } from "./argv.js"
import { timeOutputs, timerList, timerCheck, type TimeInput, type TimeOperation } from "./contracts.js"
import { privateDirectory, sqliteFiles } from "../../process/files.js"
import { withLock } from "../../process/lock.js"
import { BackendFailure } from "../../process/run.js"
import { timeFailure } from "./failures.js"
import { LIMITS, parse, fail, fence } from "../../domain/common.js"
import type { AdapterResult } from "../../domain/contract.js"
import type { ModuleContext } from "../context.js"

/** time-keep reports a missing timer as exit 1 with `{ error: { error_code: "INVALID_PARAMS", message: "timer not found: …" } }` on stderr. */
const notFound = (report: unknown) => {
  const error = (report as { error?: { error_code?: unknown; message?: unknown } } | undefined)?.error
  return error?.error_code === "INVALID_PARAMS" && typeof error.message === "string" && error.message.startsWith("timer not found")
}

export async function invoke<K extends TimeOperation>(op: K, input: TimeInput[K], ctx: ModuleContext): Promise<AdapterResult> {
  try {
    const output = op.startsWith("timer_") ? await timers(op, input, ctx) : parse(timeOutputs[op], await ctx.run(timeArgv(op, input, paths(ctx))))
    return { output, text: JSON.stringify(output) }
  } catch (error) {
    // DST gaps and overlaps, coverage and range failures get their own codes; the rest stays BACKEND_FAILED.
    throw error instanceof BackendFailure ? timeFailure(error.report, op, input) ?? error : error
  }
}
const paths = (ctx: ModuleContext) => ({ config: join(ctx.stage, "empty.toml"), store: ctx.store })

async function timers<K extends TimeOperation>(op: K, input: TimeInput[K], ctx: ModuleContext) {
  // Timers are serialized across host processes; SQLite files are inspected before every spawn.
  const run = async (args: string[], mutation = false) => { await sqliteFiles(ctx.store); fence(ctx.signal); return ctx.run(args, { mutation }) }
  await privateDirectory(ctx.store); fence(ctx.signal)
  return withLock(join(ctx.store, ".utilities-lock"), ctx.signal, async () => {
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
