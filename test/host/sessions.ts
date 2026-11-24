// A synthetic OpenCode database for the sessions stopgaps: the 2.4.1 schema from src/modules/sessions/sqlite.ts, and
// rows written at test time. Never a real database, never personal data.
import { Database } from "bun:sqlite"
import { SCHEMA } from "../../src/modules/sessions/sqlite.js"

/** The literal every fixture row contains, so a search finds all three places: a tool name, an input and an output. */
export const NEEDLE = "synthetic-needle"
export const FIXTURE_TIME = Date.UTC(2026, 10, 20, 12, 0, 0)

/** Writes the fixture at `path` and returns it. `columns` removes one column, for the schema-refusal tests. */
export function fixtureDatabase(path: string, { omit }: { readonly omit?: readonly string[] } = {}): string {
  const database = new Database(path)
  try {
    for (const [table, columns] of Object.entries(SCHEMA)) {
      const kept = columns.filter(column => !(omit ?? []).includes(`${table}.${column}`))
      database.exec(`create table "${table}" (${kept.map(column => `"${column}"`).join(", ")})`)
    }
    const insert = (table: string, row: Readonly<Record<string, unknown>>) => {
      const keys = Object.keys(row)
      database.prepare(`insert into "${table}" (${keys.map(key => `"${key}"`).join(", ")}) values (${keys.map(() => "?").join(", ")})`).run(...keys.map(key => row[key] as never))
    }
    const session = (id: string, parent: string | null, title: string, archived: number | null) => insert("session_v2", {
      id, project_id: "project_fixture", parent_id: parent, title, cost: 0.5,
      tokens_input: 100, tokens_output: 50, tokens_reasoning: 5, tokens_cache_read: 10, tokens_cache_write: 0,
      time_created: FIXTURE_TIME, time_updated: FIXTURE_TIME + 60_000, time_busy: FIXTURE_TIME + 30_000, time_idle: FIXTURE_TIME + 60_000,
      time_archived: archived, directory: "/fixture/project", agent: "build", model: "{\"id\":\"m\",\"providerID\":\"p\"}",
    })
    session("ses_fixture", null, "Synthetic fixture session", null)
    session("ses_fixture_child", "ses_fixture", "Synthetic child session", null)
    session("ses_fixture_archived", null, "Synthetic archived session", FIXTURE_TIME)
    insert("session_message", { id: "msg_fixture_user", session_id: "ses_fixture", type: "user", seq: 1, time_created: FIXTURE_TIME, data: JSON.stringify({ type: "user", text: `please review ${NEEDLE}` }) })
    insert("session_message", { id: "msg_fixture_assistant", session_id: "ses_fixture", type: "assistant", seq: 2, time_created: FIXTURE_TIME + 30_000, data: JSON.stringify({ type: "assistant", text: "not this one" }) })
    insert("session_part", {
      message_id: "msg_fixture_assistant", session_id: "ses_fixture", ordinal: 0, type: "tool", call_id: "call_fixture", time_created: FIXTURE_TIME + 30_000,
      data: JSON.stringify({
        type: "tool", name: "bash",
        state: {
          input: { command: `grep ${NEEDLE} notes.md`, path: "/fixture/project/notes.md" },
          content: [{ type: "text", text: `the ${NEEDLE} is in notes.md` }],
        },
      }),
    })
    insert("session_part", { message_id: "msg_fixture_assistant", session_id: "ses_fixture", ordinal: 1, type: "text", call_id: null, time_created: FIXTURE_TIME + 31_000, data: JSON.stringify({ type: "text", text: "an unrelated sentence" }) })
    // A file touch: the tool's input path is the only field that holds the text.
    insert("session_part", {
      message_id: "msg_fixture_assistant", session_id: "ses_fixture", ordinal: 2, type: "tool", call_id: "call_fixture_file", time_created: FIXTURE_TIME + 32_000,
      data: JSON.stringify({ type: "tool", name: "read", state: { input: { filePath: `/fixture/project/${NEEDLE}.md` }, content: [] } }),
    })
  } finally {
    database.close()
  }
  return path
}
