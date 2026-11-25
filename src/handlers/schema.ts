import * as z from "zod"
import type { JsonSchema } from "@we-the-rebel-alliance/plugin-contract/manifest"

/**
 * A zod schema as the JSON Schema the register checks with. `io: "input"` keeps a defaulted field optional, so the
 * provider applies its default when it parses; `io: "output"` marks it required, as the handler's answer always has it.
 *
 * `pattern` and `format` are dropped: OpenCode 2.4.1 disables JSON Schema patterns unless a schema is trusted, so the
 * register's own checks and the provider's zod parse are what enforce them. Descriptions stay.
 */
function convert(schema: z.ZodType, io: "input" | "output"): JsonSchema {
  const raw = z.toJSONSchema(schema, { io, unrepresentable: "any", target: "draft-2020-12" }) as Record<string, unknown>
  const cleaned = strip(raw)
  // A discriminated union has no top-level `type`; the register requires an object schema, and both branches are objects.
  return (cleaned["type"] === undefined && (cleaned["oneOf"] !== undefined || cleaned["anyOf"] !== undefined)
    ? { ...cleaned, type: "object" }
    : cleaned) as JsonSchema
}

const DROPPED = new Set(["$schema", "$comment", "pattern", "format"])

function strip(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return value.map(strip) as unknown as Record<string, unknown>
  if (value === null || typeof value !== "object") return value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, held] of Object.entries(value)) {
    if (DROPPED.has(key)) continue
    if (key === "default" && typeof held === "object" && held !== null) { out[key] = held; continue }
    out[key] = strip(held)
  }
  return out
}

/** The handler's input schema: the method's own fields, without `account` (the plugin has no accounts). */
export const inputJson = (schema: z.ZodType): JsonSchema => convert(schema, "input")
/** The handler's answer schema. */
export const outputJson = (schema: z.ZodType): JsonSchema => convert(schema, "output")
/** No input fields: a closed empty object, as the register requires for every method. */
export const NO_INPUT: JsonSchema = { type: "object", properties: {}, additionalProperties: false }
