// The two session stopgaps' logic: the schemas and dates, the public-session totals, and the read-only search's SQL,
// schema refusal and byte caps. The real `bun:sqlite` path is a host test (test/host/utilities.spec.ts); here the
// opener is injected with `node:sqlite`, so the same SQL runs against a synthetic database under vitest's Node.
import { afterEach, describe, expect, test } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { grep, sessions, type SessionInfo, type SessionSource } from "../../src/modules/sessions/adapter.js"
import { cutBytes, byteLength } from "../../src/modules/sessions/bytes.js"
import { grepInput, sessionsInput } from "../../src/modules/sessions/contracts.js"
import { SCHEMA, type SqliteDatabase } from "../../src/modules/sessions/sqlite.js"

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const temp = () => { const root = mkdtempSync(join(tmpdir(), "utilities-sessions-unit-")); roots.push(root); return root }

const TOKENS = { input: 100, output: 50, reasoning: 5, cache: { read: 10, write: 0 } }
const sessionInfo = (id: string, over: Partial<SessionInfo> = {}): SessionInfo => ({
  id, projectID: "project-a", cost: 0.5, tokens: TOKENS,
  time: { created: 1_000, updated: 2_000 }, location: { directory: "/project" }, ...over,
})

/** A source that answers with pages, and records each `list` call's input. */
function source(pages: SessionInfo[][]) {
  const calls: unknown[] = []
  const read: SessionSource = {
    directory: "/project",
    now: () => 10_000_000,
    async list(input) {
      calls.push(input)
      const index = calls.length - 1
      return { data: pages[index] ?? [], cursor: { next: index < pages.length - 1 ? `cursor-${index}` : undefined } }
    },
    async get({ sessionID }) {
      const found = pages.flat().find(session => session.id === sessionID)
      if (!found) throw new Error("session not found")
      return found
    },
  }
  return { read, calls }
}

describe("the session inputs", () => {
  test("a window takes an explicit range, days or hours, and refuses impossible calendar dates", () => {
    expect(sessionsInput.safeParse({}).success).toBe(true)
    expect(sessionsInput.safeParse({ window: { from: "2026-01-01", to: "2026-01-31" } }).success).toBe(true)
    expect(sessionsInput.safeParse({ window: { from: 1_767_225_600_000 } }).success).toBe(true)
    expect(sessionsInput.safeParse({ window: { days: 7 } }).success).toBe(true)
    expect(sessionsInput.safeParse({ window: { hours: 6 } }).success).toBe(true)
    // The calendar, not Date's rollover: 30 February and month 13 do not exist.
    for (const from of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-01-32"]) expect(sessionsInput.safeParse({ window: { from } }).success, from).toBe(false)
    expect(sessionsInput.safeParse({ window: { days: 0 } }).success).toBe(false)
    expect(sessionsInput.safeParse({ window: { from: "2026-01-01", days: 3 } }).success).toBe(false)
    expect(sessionsInput.safeParse({ limit: 101 }).success).toBe(false)
    expect(sessionsInput.safeParse({ outcome: "cancelled" }).success).toBe(false)
    expect(grepInput.safeParse({ text: "x", from: "2026-02-30" }).success).toBe(false)
    expect(grepInput.safeParse({ text: "x", to: 1_767_225_600_000 }).success).toBe(true)
    expect(grepInput.safeParse({}).success).toBe(false)
  })

  test("a date-time without an offset is read as UTC, and a byte cap cuts on a UTF-8 boundary", () => {
    const { read } = source([[sessionInfo("ses_a")]])
    return Promise.all([
      sessions({ window: { from: "2026-01-01T00:00:00" } }, read),
      sessions({ window: { from: "2026-01-01T00:00:00Z" } }, read),
    ]).then(([naive, utc]) => {
      expect(naive.output.window).toEqual(utc.output.window)
      expect(naive.output.window.from).toBe(Date.parse("2026-01-01T00:00:00Z"))
    })
  })

  test("cutBytes keeps at most the byte cap, marks a cut, and never splits a character", () => {
    expect(cutBytes("short", 512)).toBe("short")
    const cut = cutBytes("😀".repeat(300), 512)
    expect(byteLength(cut)).toBeLessThanOrEqual(512)
    expect(cut.endsWith(" …")).toBe(true)
    expect(cut).not.toContain("\uFFFD")
    expect(cutBytes("a".repeat(600), 20)).toBe(`${"a".repeat(16)} …`)
  })
})

describe("utilities_sessions", () => {
  test("pages the public list by cursor, so the totals cover every matching session", async () => {
    const child = sessionInfo("ses_child", { parentID: "ses_a", agent: "explore", outcome: "failed" })
    const { read, calls } = source([[sessionInfo("ses_a"), child], [sessionInfo("ses_c", { cost: 1.25, time: { created: 3_000, updated: 4_000 } })]])
    const { output } = await sessions({ limit: 1 }, read)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ order: "desc", directory: "/project", limit: 100 })
    expect(calls[1]).toMatchObject({ cursor: "cursor-0" })
    expect(output.totals).toEqual({
      sessions: 3, subagents: 1, cost: 2.25,
      tokens: { input: 300, output: 150, reasoning: 15, cache: { read: 30, write: 0 } },
    })
    expect(output.rows.map(row => row.id)).toEqual(["ses_a"])
    expect(output.more).toBe(true)
    expect(output.trust).toBe("untrusted")
  })

  test("filters by the window on the last update, the agent and the outcome", async () => {
    const pages = [[
      sessionInfo("ses_a", { agent: "build", outcome: "succeeded" }),
      sessionInfo("ses_b", { agent: "explore", outcome: "failed", time: { created: 1, updated: 9_000_000 } }),
      sessionInfo("ses_c", { agent: "build", time: { created: 1, updated: 3_000 } }),
    ]]
    const { read } = source(pages)
    const { output } = await sessions({ window: { from: 1_500, to: 5_000 }, agent: "build", outcome: "succeeded" }, read)
    expect(output.rows.map(row => row.id)).toEqual(["ses_a"])
    expect(output.totals.sessions).toBe(1)
  })

  test("a session id reads one session; an unknown id is INPUT_INVALID with a next step", async () => {
    const { read } = source([[sessionInfo("ses_a")]])
    expect((await sessions({ session: "ses_a" }, read)).output.rows.map(row => row.id)).toEqual(["ses_a"])
    await expect(sessions({ session: "ses_missing" }, read)).rejects.toMatchObject({ code: "INPUT_INVALID", hint: expect.stringContaining("opencode.session.search") })
  })

  test("rows are capped in bytes, with more true, never the totals", async () => {
    const long = sessionInfo("ses_long", { title: "😀".repeat(300), location: { directory: `/${"d".repeat(2000)}` } })
    const many = Array.from({ length: 100 }, (_, index) => ({ ...long, id: `ses_${index}` }))
    const { output } = await sessions({ limit: 100 }, source([many]).read)
    expect(output.totals.sessions).toBe(100)
    expect(output.rows.length).toBeLessThan(100)
    expect(byteLength(JSON.stringify(output.rows))).toBeLessThanOrEqual(65_536)
    expect(output.more).toBe(true)
  })
})

/** A synthetic database with the 2.4.1 tables. `omit` removes one table or column, for the refusal. */
function fixture(options: { readonly omit?: string; readonly rows?: number } = {}) {
  const path = join(temp(), "opencode.db")
  const database = new DatabaseSync(path)
  for (const [table, columns] of Object.entries(SCHEMA)) {
    if (options.omit === table) continue
    const kept = columns.filter(column => options.omit !== `${table}.${column}`)
    database.exec(`create table "${table}" (${kept.map(column => `"${column}"`).join(", ")})`)
  }
  const insert = (table: string, row: Record<string, unknown>) => {
    const keys = Object.keys(row)
    database.prepare(`insert into "${table}" (${keys.map(key => `"${key}"`).join(", ")}) values (${keys.map(() => "?").join(", ")})`).run(...keys.map(key => row[key] as string | number | null))
  }
  const now = Date.UTC(2026, 10, 20, 12, 0, 0)
  // A refused schema is checked before any row is read, so the refused fixture needs no rows.
  if (options.omit !== undefined) { database.close(); return path }
  if (options.omit !== "session_v2") insert("session_v2", {
    id: "ses_fixture", project_id: "project-a", parent_id: null, title: "Fixture", cost: 1, tokens_input: 1, tokens_output: 1,
    tokens_reasoning: 0, tokens_cache_read: 0, tokens_cache_write: 0, time_created: now, time_updated: now + 1_000,
    time_busy: null, time_idle: null, time_archived: null, directory: "/project", agent: "build", model: "{}",
  })
  if (options.omit !== "session_message") insert("session_message", {
    id: "msg_1", session_id: "ses_fixture", type: "user", seq: 1, time_created: now, data: JSON.stringify({ text: "please review needle-1" }),
  })
  if (options.omit !== "session_part") {
    insert("session_part", {
      message_id: "msg_1", session_id: "ses_fixture", ordinal: 0, type: "tool", call_id: "call_1", time_created: now + 500,
      data: JSON.stringify({ type: "tool", name: "bash", state: { input: { command: "grep needle-2 notes.md" }, content: [{ type: "text", text: "needle-3" }] } }),
    })
    insert("session_part", {
      message_id: "msg_1", session_id: "ses_fixture", ordinal: 1, type: "tool", call_id: "call_2", time_created: now + 600,
      data: JSON.stringify({ type: "tool", name: "read", state: { input: { filePath: "/project/needle-4.md" }, content: [] } }),
    })
    for (let index = 0; index < (options.rows ?? 0); index++) insert("session_part", {
      message_id: "msg_1", session_id: "ses_fixture", ordinal: 10 + index, type: "tool", call_id: `call_bulk_${index}`, time_created: now + 700 + index,
      data: JSON.stringify({ type: "tool", name: "bash", state: { input: { command: `needle-bulk ${"x".repeat(700)}` }, content: [] } }),
    })
  }
  database.close()
  return path
}

const open = async (path: string) => new DatabaseSync(path, { readOnly: true }) as unknown as SqliteDatabase

describe("utilities_sessions_grep", () => {
  test("searches tool names, inputs, outputs and messages, and marks a matching input path as a file touch", async () => {
    const { output } = await grep({ text: "needle-4" }, { databasePath: fixture(), open, now: () => Date.UTC(2026, 10, 21) })
    expect(output.trust).toBe("untrusted")
    expect(output.rows).toHaveLength(1)
    expect(output.rows[0]).toMatchObject({ session: "ses_fixture", message: "msg_1", part: "tool", tool: "read", field: "input.filePath", file: "/project/needle-4.md" })
    const each = async (text: string) => (await grep({ text }, { databasePath: fixture(), open, now: () => Date.UTC(2026, 10, 21) })).output.rows.map(row => row.field)
    expect(await each("needle-2")).toEqual(["input.command"])
    expect(await each("needle-3")).toEqual(["content[0].text"])
    expect(await each("needle-1")).toEqual(["message.text"])
  })

  test("matches literal text only: a regular expression is a string", async () => {
    const { output } = await grep({ text: "(a+)+$" }, { databasePath: fixture(), open, now: () => 0 })
    expect(output.rows).toEqual([])
    expect(output.scanned).toBeGreaterThan(0)
  })

  test("filters by the window, the session and the directory, and caps rows at limit", async () => {
    const at = Date.UTC(2026, 10, 20, 12, 0, 0)
    const later = await grep({ text: "needle", from: at + 10_000 }, { databasePath: fixture(), open, now: () => at })
    expect(later.output.rows).toEqual([])
    const inside = await grep({ text: "needle", from: at, to: at + 5_000, session: "ses_fixture", directory: "/project" }, { databasePath: fixture(), open, now: () => at })
    expect(inside.output.rows).toHaveLength(3)
    const other = await grep({ text: "needle", session: "ses_other" }, { databasePath: fixture(), open, now: () => at })
    expect(other.output.rows).toEqual([])
    const limited = await grep({ text: "needle", limit: 2 }, { databasePath: fixture(), open, now: () => at })
    expect(limited.output.rows).toHaveLength(2)
    expect(limited.output.more).toBe(true)
  })

  test("refuses an answer over 64 KiB with a next step, and cuts each snippet in bytes", async () => {
    await expect(grep({ text: "needle-bulk", limit: 100 }, { databasePath: fixture({ rows: 150 }), open, now: () => 0 }))
      .rejects.toMatchObject({ code: "OUTPUT_LIMIT", hint: expect.stringContaining("Lower limit") })
    const one = await grep({ text: "needle-bulk", limit: 1 }, { databasePath: fixture({ rows: 1 }), open, now: () => 0 })
    expect(byteLength(one.output.rows[0]!.snippet)).toBeLessThanOrEqual(512)
    expect(one.output.rows[0]!.snippet.endsWith(" …")).toBe(true)
  })

  test("refuses an unknown schema with the schema it found, and an unreadable database without a stack trace", async () => {
    const missing = await grep({ text: "needle" }, { databasePath: fixture({ omit: "session_message.data" }), open, now: () => 0 }).catch(error => error)
    expect(missing).toMatchObject({ code: "CONTRACT_MISMATCH" })
    expect(missing.message).toContain("session_message.data")
    expect(missing.message).toContain("Found")
    await expect(grep({ text: "needle" }, { databasePath: join(temp(), "absent.db"), open, now: () => 0 }))
      .rejects.toMatchObject({ code: "OPERATION_FAILED", hint: expect.stringContaining("sessionsDatabasePath") })
  })
})
