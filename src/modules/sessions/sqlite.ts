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

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** A parsed data column, or undefined when the text is not a JSON object. `data` columns are JSON text in 2.4.1. */
const object = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (typeof value !== "string") return undefined
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

const refuse = (what: string): never => fail("CONTRACT_MISMATCH", {
  message: `OpenCode's session database is not the shape this stopgap reads: ${what}.`,
  hint: "Update the plugin, or find the session with opencode.session.search instead.",
})

/** The JSON kind of a sampled value only: a data column may hold secrets, so the value is never echoed. */
const kind = (value: unknown): string =>
  value === undefined ? "no type"
  : value === null ? "null"
  : Array.isArray(value) ? "an array"
  : typeof value === "string" ? "a string"
  : typeof value === "number" ? "a number"
  : typeof value === "boolean" ? "a boolean"
  : "an object"

/**
 * Beyond the columns: the data envelope this stopgap reads. A `session_part.data` is a JSON object whose `type` is the
 * row's type; text and reasoning parts carry a string `text`, tool parts a string `name` and an object `state`; a
 * `session_message.data` carries a numeric `time.created`. Each table's newest rows are sampled (an empty one has
 * nothing to check), so a database with the same columns and a changed shape is refused instead of silently returning no
 * rows.
 */
export function checkShape(database: SqliteDatabase): void {
  for (const row of database.prepare("select type, data from session_part order by time_created desc, rowid desc limit 10").all()) {
    const type = String(row["type"]), data = object(row["data"]), where = `session_part.data for a ${type} row`
    if (data === undefined) refuse(`${where} is not a JSON object`)
    if (data!["type"] !== type) refuse(`${where} has ${kind(data!["type"])}, not the row's type ${JSON.stringify(type)}`)
    if (type === "text" || type === "reasoning") if (typeof data!["text"] !== "string") refuse(`${where} has no string text`)
    if (type === "tool") {
      if (typeof data!["name"] !== "string") refuse(`${where} has no string name`)
      if (!isObject(data!["state"])) refuse(`${where} has no object state`)
    }
  }
  for (const row of database.prepare("select data from session_message order by time_created desc, rowid desc limit 5").all()) {
    const data = object(row["data"])
    if (data === undefined) refuse("session_message.data is not a JSON object")
    const time = data!["time"]
    if (!isObject(time) || typeof time["created"] !== "number" || !Number.isFinite(time["created"])) refuse("session_message.data has no numeric time.created")
  }
}

/** Reads the schema and the sampled data shape this stopgap needs, and refuses with what it found instead of guessing. */
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
  if (missing.length > 0) fail("CONTRACT_MISMATCH", {
    message: `OpenCode's session database is not the schema this stopgap reads: missing ${missing.slice(0, 8).join(", ")}. Found ${found.join("; ") || "no such tables"}.`,
    hint: "Update the plugin, or find the session with opencode.session.search instead.",
  })
  checkShape(database)
}
