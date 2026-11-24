import { fail } from "../../domain/common.js"

// OpenCode's SQLite database, read-only. This is the one documented exception to "public OpenCode APIs only"
// (the family's public-API rule, with this one documented exception): a read-only connection, a clean refusal on an
// unknown schema, and the pinned host range.
// `utilities_sessions_grep` is deleted when OpenCode ships exact-text search over past sessions.

export type SqlValue = string | number | null
/** One row, by column name. SQLite returns null-prototype objects through some drivers, so this stays a plain record. */
export type SqliteRow = Readonly<Record<string, unknown>>

export interface SqliteStatement {
  all(...parameters: readonly SqlValue[]): readonly SqliteRow[]
  get(...parameters: readonly SqlValue[]): SqliteRow | undefined
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  exec(sql: string): void
  close(): void
}

/** Opens the database read-only. Injected by tests with a fake, or with `node:sqlite` for a synthetic fixture. */
export type OpenDatabase = (path: string) => Promise<SqliteDatabase>

/**
 * The tables and columns this stopgap reads, from OpenCode 2.4.1's schema (`session_v2`, `session_message`,
 * `session_part`). A missing table or column is refused with the schema that was found, never a stack trace.
 */
export const SCHEMA = {
  session_v2: [
    "id", "project_id", "parent_id", "title", "cost",
    "tokens_input", "tokens_output", "tokens_reasoning", "tokens_cache_read", "tokens_cache_write",
    "time_created", "time_updated", "time_busy", "time_idle", "time_archived",
    "directory", "agent", "model",
  ],
  session_message: ["id", "session_id", "type", "seq", "time_created", "data"],
  session_part: ["message_id", "session_id", "ordinal", "type", "call_id", "time_created", "data"],
} as const

/**
 * `bun:sqlite` is a host built-in, not a package: the import stays dynamic so the Node unit tests can inject a database
 * instead, and `scripts/build.mjs` leaves it external. Bun 1.4.5 calls the class `Database` and the option `readonly`
 * (`node_modules/bun-types/sqlite.d.ts`); there is no `DatabaseSync` export.
 */
export const openDatabase: OpenDatabase = async path => {
  const { Database } = await import("bun:sqlite")
  const database = new Database(path, { readonly: true })
  // A connection setting, not a write: a plugin read waits for the host's write lock instead of failing at once.
  database.exec("pragma busy_timeout=5000")
  return {
    prepare(sql) {
      const statement = database.prepare(sql)
      return {
        all: (...parameters) => statement.all(...parameters as never[]) as SqliteRow[],
        get: (...parameters) => statement.get(...parameters as never[]) as SqliteRow | undefined,
      }
    },
    exec: sql => database.exec(sql),
    close: () => database.close(),
  }
}

/** Reads the schema this stopgap needs, and refuses with what it found instead of guessing. */
export function checkSchema(database: SqliteDatabase): void {
  const tables = new Set(database.prepare("select name from sqlite_master where type = 'table'").all().map(row => String(row["name"])))
  const found: string[] = []
  const missing: string[] = []
  for (const [table, columns] of Object.entries(SCHEMA)) {
    if (!tables.has(table)) {
      missing.push(`table ${table}`)
      continue
    }
    const names = database.prepare("select name from pragma_table_info(?)").all(table).map(row => String(row["name"]))
    found.push(`${table}(${names.slice(0, 24).join(", ")})`)
    for (const column of columns) if (!names.includes(column)) missing.push(`${table}.${column}`)
  }
  if (missing.length === 0) return
  fail("CONTRACT_MISMATCH", {
    message: `OpenCode's session database is not the schema this stopgap reads: missing ${missing.slice(0, 8).join(", ")}. Found ${found.join("; ") || "no such tables"}.`,
    hint: "Update the plugin, or find the session with opencode.session.search instead.",
  })
}
