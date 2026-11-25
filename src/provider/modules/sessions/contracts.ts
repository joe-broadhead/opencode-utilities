import * as z from "zod"
import { date, datetime } from "../../../domain/common.js"

// The two session stopgaps' schemas. `utilities_sessions` reads the public ctx.session API; the tool's
// input and output are here so the tool registry, the tools RPC and the docs share one shape.
// `utilities_sessions_grep` reads OpenCode's SQLite database read-only, the one documented exception to public APIs.

/** An ISO 8601 date or date-time. A date-time without Z or an offset is read as UTC, as every Utilities date input is. */
const ISO = z.string().max(80).refine(
  value => date.safeParse(value).success || datetime.safeParse(value).success,
  "must be an ISO 8601 date (YYYY-MM-DD) or date-time, or epoch milliseconds",
)
/**
 * An instant: epoch milliseconds, or an ISO 8601 date or date-time. The calendar check is `date`'s: an impossible day
 * such as 2026-02-30 or month 2026-13-01 fails HERE, never rolled over by `new Date`.
 */
export const instant = z.union([z.number().int().safe(), ISO])

/** A window: an explicit from/to, or a length ending now. The three forms are exclusive. */
export const windowInput = z.union([
  z.strictObject({
    from: instant.describe("the window's start: an ISO 8601 date or date-time, or epoch milliseconds").optional(),
    to: instant.describe("the window's end: an ISO 8601 date or date-time, or epoch milliseconds").optional(),
  }),
  z.strictObject({ days: z.number().int().min(1).max(3650).describe("the window's length in days, ending now") }),
  z.strictObject({ hours: z.number().int().min(1).max(87600).describe("the window's length in hours, ending now") }),
])

export const sessionsInput = z.strictObject({
  session: z.string().min(1).max(256).describe("one session id to read instead of a list").optional(),
  window: windowInput.describe("the window on each session's last update (a new session's creation), such as {days: 7}").optional(),
  project: z.string().min(1).max(256).describe("only sessions in this project").optional(),
  directory: z.string().min(1).max(4096).describe("only sessions whose directory is this one; the current directory by default").optional(),
  archived: z.boolean().describe("true lists archived sessions only, false live sessions only; omitted lists both").optional(),
  agent: z.string().min(1).max(128).describe("only sessions whose agent is this one").optional(),
  outcome: z.enum(["succeeded", "failed", "interrupted"]).describe("only sessions that ended this way").optional(),
  limit: z.number().int().min(1).max(100).describe("the most rows to return: 20 by default, at most 100").optional(),
})

export type SessionsInput = z.output<typeof sessionsInput>

const tokens = z.strictObject({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  reasoning: z.number().int().nonnegative(),
  cache: z.strictObject({ read: z.number().int().nonnegative(), write: z.number().int().nonnegative() }),
})
export type SessionTokens = z.output<typeof tokens>

const sessionRow = z.strictObject({
  id: z.string().max(256),
  title: z.string().max(1200).optional(),
  parent: z.string().max(256).optional(),
  project: z.string().max(256),
  agent: z.string().max(128).optional(),
  model: z.string().max(256).optional(),
  outcome: z.enum(["succeeded", "failed", "interrupted"]).optional(),
  /** Absent when the host reported no cost for the session: unknown, never 0. */
  cost: z.number().optional(),
  /** Absent when the host reported no token counts: unknown, never 0. */
  tokens: tokens.optional(),
  created: z.number().int(),
  updated: z.number().int(),
  busy: z.number().int().optional(),
  idle: z.number().int().optional(),
  archived: z.number().int().optional(),
  directory: z.string().max(4096),
})

export const sessionsOutput = z.strictObject({
  window: z.strictObject({ from: z.number().int().nullable(), to: z.number().int().nullable() }),
  totals: z.strictObject({
    sessions: z.number().int().nonnegative(),
    subagents: z.number().int().nonnegative(),
    cost: z.number(),
    /** Sessions whose cost, or whose token counts, the host did not report; they are left out of the sums. */
    unknownCost: z.number().int().nonnegative(),
    unknownTokens: z.number().int().nonnegative(),
    tokens,
  }),
  rows: z.array(sessionRow).max(100),
  more: z.boolean(),
  trust: z.literal("untrusted"),
})
export type SessionsOutput = z.output<typeof sessionsOutput>
export type SessionRow = z.output<typeof sessionRow>

export const grepInput = z.strictObject({
  text: z.string().min(1).max(1024).describe("the exact text to find; it is matched literally, never as a regular expression"),
  from: instant.describe("the earliest instant to search: an ISO 8601 date or date-time, or epoch milliseconds").optional(),
  to: instant.describe("the latest instant to search: an ISO 8601 date or date-time, or epoch milliseconds").optional(),
  session: z.string().min(1).max(256).describe("only this session's messages and parts").optional(),
  directory: z.string().min(1).max(4096).describe("only sessions whose directory is this one").optional(),
  limit: z.number().int().min(1).max(100).describe("the most rows to return: 20 by default, at most 100").optional(),
})

export type GrepInput = z.output<typeof grepInput>

const grepRow = z.strictObject({
  session: z.string().max(256),
  title: z.string().max(1200).optional(),
  message: z.string().max(256),
  seq: z.number().int().optional(),
  part: z.string().max(64).optional(),
  tool: z.string().max(256).optional(),
  /** Absent when the row has no readable time: unknown, never 0. */
  time: z.number().int().optional(),
  field: z.string().max(160),
  snippet: z.string().max(2048),
  file: z.string().max(4096).optional(),
})

export const grepOutput = z.strictObject({
  query: z.string().max(1024),
  window: z.strictObject({ from: z.number().int().nullable(), to: z.number().int().nullable() }),
  scanned: z.number().int().nonnegative(),
  rows: z.array(grepRow).max(100),
  more: z.boolean(),
  /** Some text was longer or deeper than the search reads, so a match may be missing. */
  truncated: z.boolean(),
  trust: z.literal("untrusted"),
})
export type GrepOutput = z.output<typeof grepOutput>
export type GrepRow = z.output<typeof grepRow>
