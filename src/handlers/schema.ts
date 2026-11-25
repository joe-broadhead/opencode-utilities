import * as z from "zod"
import type { JsonSchema } from "@we-the-rebel-alliance/plugin-contract/manifest"

/**
 * A zod schema as the JSON Schema the register checks with. `io: "input"` keeps a defaulted field optional, so the
 * provider applies its default when it parses; `io: "output"` marks it required, as the handler's answer always has it.
 *
 * `pattern` and `format` are dropped as schema keywords: OpenCode 2.4.1 disables JSON Schema patterns unless a schema
 * is trusted, so the register's own checks and the provider's zod parse are what enforce them. A property NAMED
 * `format` or `pattern` is not a keyword: names inside `properties`, `patternProperties`, `$defs` and `definitions`
 * stay. Descriptions stay.
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
/** Keys whose value is a map of user-chosen names, not schema keywords: a property called `format` must survive. */
const NAMED_MAPS = new Set(["properties", "patternProperties", "$defs", "definitions"])

function strip(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return value.map(strip) as unknown as Record<string, unknown>
  if (value === null || typeof value !== "object") return value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, held] of Object.entries(value)) {
    if (DROPPED.has(key)) continue
    if (key === "default" && typeof held === "object" && held !== null) { out[key] = held; continue }
    if (NAMED_MAPS.has(key) && held !== null && typeof held === "object" && !Array.isArray(held)) {
      // A map of names: keep every name, and strip only the schema keywords inside each value.
      const names: Record<string, unknown> = {}
      for (const [name, schema] of Object.entries(held)) names[name] = strip(schema)
      out[key] = names
      continue
    }
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
