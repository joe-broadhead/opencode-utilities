// The two session stopgaps' logic: the schemas and dates, the public-session totals, and the read-only search's SQL,
// schema and data-shape refusal, masking and byte caps. The bundle's one dynamic import, `bun:sqlite`, is asserted in
// test/pack/install.spec.ts; here the opener is injected with `node:sqlite`, so the same SQL runs against a synthetic
// database under vitest's Node. Every fixture builds from the recorded 2.4.1 schema in test/fixtures/, never from the
// production column list, so a fixture cannot silently drift from the host's own DDL.
import { afterEach, describe, expect, test } from "vitest"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { DatabaseSync } from "node:sqlite"
import { grep, sessions, type SessionInfo, type SessionSource } from "../../src/provider/modules/sessions/adapter.js"
import { cutBytes, byteLength } from "../../src/provider/modules/sessions/bytes.js"
import { grepInput, sessionsInput } from "../../src/provider/modules/sessions/contracts.js"
import type { SqliteDatabase } from "../../src/provider/modules/sessions/sqlite.js"

/** The invented credential shapes the mask must catch. Built from parts so no committed line carries one. */
const SECRETS = {
  github: ["ghp_", "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join(""),
  pat: ["github_pat_", "11ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].join(""),
  aws: ["AKIA", "IOSFODNN7EXAMPLE"].join(""),
  jwt: ["eyJ", "hbGciOiJIUzI1NiJ9"].join(""),
  project: ["sk-proj-", "abcdefghijklmnop"].join(""),
  password: ["hunt", "er2"].join(""),
}

const SCHEMA_SQL = readFileSync(fileURLToPath(new URL("../fixtures/opencode-2.4.1-schema.sql", import.meta.url)), "utf8")
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

  test("a date-time without an offset is read as UTC, and a byte cap cuts on a UTF-8 boundary", async () => {
    const { read } = source([[sessionInfo("ses_a")]])
    const [naive, utc] = await Promise.all([
      sessions({ window: { from: "2026-01-01T00:00:00" } }, read),
      sessions({ window: { from: "2026-01-01T00:00:00Z" } }, read),
    ])
    expect(naive.window).toEqual(utc.window)
    expect(naive.window.from).toBe(Date.parse("2026-01-01T00:00:00Z"))
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
    const output = await sessions({ limit: 1 }, read)
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ order: "desc", directory: "/project", limit: 100 })
    expect(calls[1]).toMatchObject({ cursor: "cursor-0" })
    expect(output.totals).toEqual({
      sessions: 3, subagents: 1, cost: 2.25, unknownCost: 0, unknownTokens: 0,
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
    const output = await sessions({ window: { from: 1_500, to: 5_000 }, agent: "build", outcome: "succeeded" }, read)
    expect(output.rows.map(row => row.id)).toEqual(["ses_a"])
    expect(output.totals.sessions).toBe(1)
  })

  test("a session id reads one session; an unknown id is INPUT_INVALID with a next step", async () => {
    const { read } = source([[sessionInfo("ses_a")]])
    expect((await sessions({ session: "ses_a" }, read)).rows.map(row => row.id)).toEqual(["ses_a"])
    await expect(sessions({ session: "ses_missing" }, read)).rejects.toMatchObject({ code: "INPUT_INVALID", hint: expect.stringContaining("opencode.session.search") })
  })

  test("a cost or token count the host did not report is unknown, never zero", async () => {
    const { cost: _cost, tokens: _tokens, ...bare } = sessionInfo("ses_bare")
    const partial = sessionInfo("ses_partial", { tokens: { input: 1, output: 2, reasoning: 3 } })
    const output = await sessions({}, source([[bare as SessionInfo, partial]]).read)
    expect(output.totals).toMatchObject({ sessions: 2, cost: 0.5, unknownCost: 1, unknownTokens: 2 })
    expect(output.totals.tokens).toEqual({ input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })
    for (const row of output.rows) {
      expect("cost" in row).toBe(row.id !== "ses_bare")
      expect("tokens" in row).toBe(false)
    }
  })

  test("a session title or directory holding a secret is masked", async () => {
    const token = SECRETS.github
    const output = await sessions({}, source([[sessionInfo("ses_secret", { title: `Title ${token}`, location: { directory: `/project/${token}` } })]]).read)
    expect(JSON.stringify(output)).not.toContain(token)
    expect(output.rows[0]!.title).toBe("Title ghp_[redacted]")
    expect(output.rows[0]!.directory).toBe("/project/ghp_[redacted]")
  })

  test("rows are capped in bytes, with more true, never the totals", async () => {
    const long = sessionInfo("ses_long", { title: "😀".repeat(300), location: { directory: `/${"d".repeat(2000)}` } })
    const many = Array.from({ length: 100 }, (_, index) => ({ ...long, id: `ses_${index}` }))
    const output = await sessions({ limit: 100 }, source([many]).read)
    expect(output.totals.sessions).toBe(100)
    expect(output.rows.length).toBeLessThan(100)
    expect(byteLength(JSON.stringify(output.rows))).toBeLessThanOrEqual(65_536)
    expect(output.more).toBe(true)
  })
})

interface FixtureOptions {
  /** Remove one table or one column (`table.column`), for the schema refusal. */
  readonly omit?: string
  /** Extra bulk parts whose text matches `needle-bulk`. */
  readonly rows?: number
  /** A text part whose data is not the 2.4.1 envelope. */
  readonly badPart?: boolean
  /** A message whose data is not the 2.4.1 envelope. */
  readonly badMessage?: boolean
  /** A tool part with credentials in its input. */
  readonly secrets?: boolean
  /** A tool part whose input has more strings than the search reads. */
  readonly manyInputs?: boolean
  /** A tool part whose time_created is not a number. */
  readonly unknownTime?: boolean
}

/** A synthetic database built from the recorded 2.4.1 DDL, with rows written here. */
function fixture(options: FixtureOptions = {}) {
  const path = join(temp(), "opencode.db")
  const database = new DatabaseSync(path, { enableForeignKeyConstraints: false })
  database.exec(SCHEMA_SQL)
  if (options.omit !== undefined) {
    const [table, column] = options.omit.split(".") as [string, string]
    database.exec(`alter table "${table}" drop column "${column}"`)
    database.close()
    return path
  }
  const insert = (table: string, row: Record<string, unknown>) => {
    const keys = Object.keys(row)
    database.prepare(`insert into "${table}" (${keys.map(key => `"${key}"`).join(", ")}) values (${keys.map(() => "?").join(", ")})`).run(...keys.map(key => row[key] as string | number | null))
  }
  const now = Date.UTC(2026, 10, 20, 12, 0, 0)
  insert("project", { id: "project-fixture", worktree: "/project", time_created: now, time_updated: now, sandboxes: "[]" })
  insert("session_v2", {
    id: "ses_fixture", project_id: "project-fixture", parent_id: null, slug: "fixture", title: `Fixture ${SECRETS.github}`,
    cost: 1, tokens_input: 1, tokens_output: 1, tokens_reasoning: 0, tokens_cache_read: 0, tokens_cache_write: 0,
    time_created: now, time_updated: now + 1_000, time_busy: null, time_idle: null, time_archived: null,
    directory: "/project", version: "2.4.1", agent: "build", model: "{}",
  })
  const messageData = options.badMessage ? { body: "x" } : { type: "user", time: { created: now }, text: "please review needle-1" }
  insert("session_message", { id: "msg_1", session_id: "ses_fixture", type: "user", seq: 1, time_created: now, time_updated: now, data: JSON.stringify(messageData) })
  if (options.badPart) {
    insert("session_part", {
      message_id: "msg_1", session_id: "ses_fixture", ordinal: 0, type: "text", call_id: null, time_created: now + 100, time_updated: now + 100,
      data: JSON.stringify({ body: "x" }),
    })
    database.close()
    return path
  }
  insert("session_part", {
    message_id: "msg_1", session_id: "ses_fixture", ordinal: 0, type: "tool", call_id: "call_1", time_created: now + 500, time_updated: now + 500,
    data: JSON.stringify({ type: "tool", name: "bash", state: { input: { command: "grep needle-2 notes.md" }, content: [{ type: "text", text: "needle-3" }] } }),
  })
  insert("session_part", {
    message_id: "msg_1", session_id: "ses_fixture", ordinal: 1, type: "tool", call_id: "call_2", time_created: now + 600, time_updated: now + 600,
    data: JSON.stringify({ type: "tool", name: "read", state: { input: { filePath: "/project/needle-4.md" }, content: [] } }),
  })
  for (let index = 0; index < (options.rows ?? 0); index++) insert("session_part", {
    message_id: "msg_1", session_id: "ses_fixture", ordinal: 10 + index, type: "tool", call_id: `call_bulk_${index}`, time_created: now + 700 + index, time_updated: now + 700 + index,
    data: JSON.stringify({ type: "tool", name: "bash", state: { input: { command: `needle-bulk ${"x".repeat(700)}` }, content: [] } }),
  })
  if (options.secrets) {
    const command = `echo needle ${SECRETS.github} ${SECRETS.pat} ${SECRETS.aws} pass${"word"}=${SECRETS.password} ${SECRETS.project} "Authorization: Bearer ${SECRETS.jwt}.payload" tok${"en"}=abc123 access_${"token"}=def456 api_${"key"}=ghi789 api${"key"}=jkl012 sec${"ret"}=mno345`
    insert("session_part", {
      message_id: "msg_1", session_id: "ses_fixture", ordinal: 20, type: "tool", call_id: "call_secret", time_created: now + 800, time_updated: now + 800,
      data: JSON.stringify({ type: "tool", name: "bash", state: { input: { command }, content: [] } }),
    })
    insert("session_part", {
      message_id: "msg_1", session_id: "ses_fixture", ordinal: 21, type: "tool", call_id: "call_secret_file", time_created: now + 850, time_updated: now + 850,
      data: JSON.stringify({ type: "tool", name: "read", state: { input: { filePath: `/project/${SECRETS.github}.md` }, content: [] } }),
    })
    insert("session_message", {
      id: "msg_secret", session_id: "ses_fixture", type: "user", seq: 2, time_created: now + 900, time_updated: now + 900,
      data: JSON.stringify({ type: "user", time: { created: now + 900 }, text: `needle {"pass${"word"}":"${SECRETS.password}"} {"api_${"key"}":"abc123"} pass${"wd"}=letmein` }),
    })
  }
  if (options.manyInputs) {
    const input = Object.fromEntries(Array.from({ length: 250 }, (_, index) => [`key${index}`, index === 249 ? "needle-deep" : "plain"]))
    insert("session_part", {
      message_id: "msg_1", session_id: "ses_fixture", ordinal: 21, type: "tool", call_id: "call_deep", time_created: now + 1_000, time_updated: now + 1_000,
      data: JSON.stringify({ type: "tool", name: "bash", state: { input, content: [] } }),
    })
  }
  if (options.unknownTime) {
    insert("session_part", {
      message_id: "msg_1", session_id: "ses_fixture", ordinal: 22, type: "tool", call_id: "call_time", time_created: "later", time_updated: now,
      data: JSON.stringify({ type: "tool", name: "bash", state: { input: { command: "needle-time" }, content: [] } }),
    })
  }
  database.close()
  return path
}

const open = async (path: string) => new DatabaseSync(path, { readOnly: true }) as unknown as SqliteDatabase
const at = Date.UTC(2026, 10, 20, 12, 0, 0)

describe("utilities_sessions_grep", () => {
  test("searches tool names, inputs, outputs and messages, and marks a matching input path as a file touch", async () => {
    const output = await grep({ text: "needle-4" }, { databasePath: fixture(), open, now: () => at })
    expect(output.trust).toBe("untrusted")
    expect(output.truncated).toBe(false)
    expect(output.rows).toHaveLength(1)
    expect(output.rows[0]).toMatchObject({ session: "ses_fixture", message: "msg_1", part: "tool", tool: "read", field: "input.filePath", file: "/project/needle-4.md", time: at + 600 })
    const each = async (text: string) => (await grep({ text }, { databasePath: fixture(), open, now: () => at })).rows.map(row => row.field)
    expect(await each("needle-2")).toEqual(["input.command"])
    expect(await each("needle-3")).toEqual(["content[0].text"])
    expect(await each("needle-1")).toEqual(["message.text"])
  })

  test("matches literal text only: a regular expression is a string", async () => {
    const output = await grep({ text: "(a+)+$" }, { databasePath: fixture(), open, now: () => at })
    expect(output.rows).toEqual([])
    expect(output.scanned).toBeGreaterThan(0)
  })

  test("masks credentials in every field and in the rendered text, and in the echoed query", async () => {
    const result = await grep({ text: "needle" }, { databasePath: fixture({ secrets: true }), open, now: () => at })
    const json = JSON.stringify(result)
    const secrets = [
      SECRETS.github, SECRETS.pat,
      SECRETS.aws, SECRETS.password, SECRETS.project, SECRETS.jwt,
      "abc123", "def456", "ghi789", "jkl012", "mno345", "letmein",
    ]
    for (const secret of secrets) {
      expect(json, secret).not.toContain(secret)
    }
    for (const marker of [
      "ghp_[redacted]", "github_pat_[redacted]", "AKIA****************", "password=[redacted]", "passwd=[redacted]",
      "sk-proj-[redacted]", "Bearer [redacted]", "token=[redacted]", "access_token=[redacted]", "api_key=[redacted]",
      "secret=[redacted]",
    ]) expect(json, marker).toContain(marker)
    // The session title (in every row), the tool command (a snippet), the file path and the message are all masked.
    expect(result.rows.every(row => row.title === "Fixture ghp_[redacted]")).toBe(true)
    expect(result.rows.some(row => row.field === "input.command" && row.snippet.includes("ghp_[redacted]"))).toBe(true)
    expect(result.rows.some(row => row.field === "message.text" && row.snippet.includes('{"password":"[redacted]"} {"api_key":"[redacted]"}'))).toBe(true)
    // A search for a GitHub token echoes the query masked, still finds the rows, and names the masked file path.
    const token = await grep({ text: SECRETS.github }, { databasePath: fixture({ secrets: true }), open, now: () => at })
    expect(token.query).toBe("ghp_[redacted]")
    expect(token.rows.length).toBeGreaterThan(0)
    expect(token.rows.some(row => row.file === "/project/ghp_[redacted].md")).toBe(true)
    expect(JSON.stringify(token)).not.toContain(SECRETS.github)
  })

  test("filters by the window, the session and the directory, and caps rows at limit", async () => {
    const later = await grep({ text: "needle", from: at + 10_000 }, { databasePath: fixture(), open, now: () => at })
    expect(later.rows).toEqual([])
    const inside = await grep({ text: "needle", from: at, to: at + 5_000, session: "ses_fixture", directory: "/project" }, { databasePath: fixture(), open, now: () => at })
    expect(inside.rows).toHaveLength(3)
    const other = await grep({ text: "needle", session: "ses_other" }, { databasePath: fixture(), open, now: () => at })
    expect(other.rows).toEqual([])
    const limited = await grep({ text: "needle", limit: 2 }, { databasePath: fixture(), open, now: () => at })
    expect(limited.rows).toHaveLength(2)
    expect(limited.more).toBe(true)
  })

  test("refuses an answer over 64 KiB with a next step, and cuts each snippet in bytes", async () => {
    await expect(grep({ text: "needle-bulk", limit: 100 }, { databasePath: fixture({ rows: 150 }), open, now: () => at }))
      .rejects.toMatchObject({ code: "OUTPUT_LIMIT", hint: expect.stringContaining("Lower limit") })
    const one = await grep({ text: "needle-bulk", limit: 1 }, { databasePath: fixture({ rows: 1 }), open, now: () => at })
    expect(byteLength(one.rows[0]!.snippet)).toBeLessThanOrEqual(512)
    expect(one.rows[0]!.snippet.endsWith(" …")).toBe(true)
  })

  test("reports a row time it could not read as unknown, never as zero", async () => {
    const output = await grep({ text: "needle-time" }, { databasePath: fixture({ unknownTime: true }), open, now: () => at })
    expect(output.rows).toHaveLength(1)
    expect("time" in output.rows[0]!).toBe(false)
    expect(JSON.stringify(output)).not.toContain("1970")
  })

  test("a walk that stops at its cap is truncated, never a clean no-match", async () => {
    const output = await grep({ text: "needle-deep" }, { databasePath: fixture({ manyInputs: true }), open, now: () => at })
    expect(output.rows).toEqual([])
    expect(output.truncated).toBe(true)
    expect(output.more).toBe(true)
  })

  test("refuses an unknown schema with the schema it found, and an unreadable database without a stack trace", async () => {
    const missing = await grep({ text: "needle" }, { databasePath: fixture({ omit: "session_message.data" }), open, now: () => at }).catch(error => error)
    expect(missing).toMatchObject({ code: "CONTRACT_MISMATCH" })
    expect(missing.message).toContain("session_message.data")
    expect(missing.message).toContain("Found")
    await expect(grep({ text: "needle" }, { databasePath: join(temp(), "absent.db"), open, now: () => at }))
      .rejects.toMatchObject({ code: "OPERATION_FAILED", hint: expect.stringContaining("sessionsDatabasePath") })
  })

  test("refuses a changed data shape, not only changed columns", async () => {
    const part = await grep({ text: "needle" }, { databasePath: fixture({ badPart: true }), open, now: () => at }).catch(error => error)
    expect(part).toMatchObject({ code: "CONTRACT_MISMATCH" })
    expect(part.message).toContain("session_part.data")
    expect(part.message).toContain("text")
    const message = await grep({ text: "needle" }, { databasePath: fixture({ badMessage: true }), open, now: () => at }).catch(error => error)
    expect(message).toMatchObject({ code: "CONTRACT_MISMATCH" })
    expect(message.message).toContain("session_message.data")
    expect(message.message).toContain("time.created")
  })
})
