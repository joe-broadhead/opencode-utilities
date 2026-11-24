// A synthetic OpenCode database for the sessions stopgaps: the recorded 2.4.1 schema from test/fixtures/, and rows
// written at test time. Never a real database, never personal data.
import { Database } from "bun:sqlite"
import { readFileSync } from "node:fs"

const SCHEMA_SQL = readFileSync(new URL("../fixtures/opencode-2.4.1-schema.sql", import.meta.url), "utf8")

/** The literal every fixture row contains, so a search finds all three places: an input, an output and a message. */
export const NEEDLE = "synthetic-needle"
export const FIXTURE_TIME = Date.UTC(2026, 10, 20, 12, 0, 0)

interface FixtureOptions {
  /** Write a `session_part.data` that is not the 2.4.1 envelope. */
  readonly badPart?: boolean
  /** Write a `session_message.data` that is not the 2.4.1 envelope. */
  readonly badMessage?: boolean
}

/** Writes the fixture at `path` and returns it. */
export function fixtureDatabase(path: string, options: FixtureOptions = {}): string {
  const database = new Database(path)
  try {
    database.exec(SCHEMA_SQL)
    const insert = (table: string, row: Readonly<Record<string, unknown>>) => {
      const keys = Object.keys(row)
      database.prepare(`insert into "${table}" (${keys.map(key => `"${key}"`).join(", ")}) values (${keys.map(() => "?").join(", ")})`).run(...keys.map(key => row[key] as never))
    }
    insert("project", { id: "project_fixture", worktree: "/fixture/project", time_created: FIXTURE_TIME, time_updated: FIXTURE_TIME, sandboxes: "[]" })
    const session = (id: string, parent: string | null, title: string, archived: number | null) => insert("session_v2", {
      id, project_id: "project_fixture", parent_id: parent, slug: id, title, cost: 0.5,
      tokens_input: 100, tokens_output: 50, tokens_reasoning: 5, tokens_cache_read: 10, tokens_cache_write: 0,
      time_created: FIXTURE_TIME, time_updated: FIXTURE_TIME + 60_000, time_busy: FIXTURE_TIME + 30_000, time_idle: FIXTURE_TIME + 60_000,
      time_archived: archived, directory: "/fixture/project", version: "2.4.1", agent: "build", model: "{\"id\":\"m\",\"providerID\":\"p\"}",
    })
    session("ses_fixture", null, "Synthetic fixture session", null)
    session("ses_fixture_child", "ses_fixture", "Synthetic child session", null)
    session("ses_fixture_archived", null, "Synthetic archived session", FIXTURE_TIME)
    insert("session_message", { id: "msg_fixture_user", session_id: "ses_fixture", type: "user", seq: 1, time_created: FIXTURE_TIME, time_updated: FIXTURE_TIME, data: JSON.stringify({ type: "user", time: { created: FIXTURE_TIME }, text: `please review ${NEEDLE}` }) })
    insert("session_message", { id: "msg_fixture_assistant", session_id: "ses_fixture", type: "assistant", seq: 2, time_created: FIXTURE_TIME + 30_000, time_updated: FIXTURE_TIME + 30_000, data: JSON.stringify({ type: "assistant", time: { created: FIXTURE_TIME + 30_000 }, text: "not this one" }) })
    insert("session_part", {
      message_id: "msg_fixture_assistant", session_id: "ses_fixture", ordinal: 0, type: "tool", call_id: "call_fixture", time_created: FIXTURE_TIME + 30_000, time_updated: FIXTURE_TIME + 30_000,
      data: JSON.stringify({
        type: "tool", name: "bash",
        state: {
          input: { command: `grep ${NEEDLE} notes.md`, path: "/fixture/project/notes.md" },
          content: [{ type: "text", text: `the ${NEEDLE} is in notes.md` }],
        },
      }),
    })
    insert("session_part", { message_id: "msg_fixture_assistant", session_id: "ses_fixture", ordinal: 1, type: "text", call_id: null, time_created: FIXTURE_TIME + 31_000, time_updated: FIXTURE_TIME + 31_000, data: JSON.stringify({ type: "text", text: "an unrelated sentence" }) })
    // A file touch: the tool's input path is the only field that holds the text.
    insert("session_part", {
      message_id: "msg_fixture_assistant", session_id: "ses_fixture", ordinal: 2, type: "tool", call_id: "call_fixture_file", time_created: FIXTURE_TIME + 32_000, time_updated: FIXTURE_TIME + 32_000,
      data: JSON.stringify({ type: "tool", name: "read", state: { input: { filePath: `/fixture/project/${NEEDLE}.md` }, content: [] } }),
    })
    if (options.badPart) insert("session_part", {
      message_id: "msg_fixture_assistant", session_id: "ses_fixture", ordinal: 3, type: "text", call_id: null, time_created: FIXTURE_TIME + 33_000, time_updated: FIXTURE_TIME + 33_000,
      data: JSON.stringify({ body: "x" }),
    })
    if (options.badMessage) insert("session_message", { id: "msg_fixture_bad", session_id: "ses_fixture", type: "user", seq: 3, time_created: FIXTURE_TIME + 34_000, time_updated: FIXTURE_TIME + 34_000, data: JSON.stringify({ body: "x" }) })
  } finally {
    database.close()
  }
  return path
}
