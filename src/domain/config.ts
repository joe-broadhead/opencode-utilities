import * as z from "zod"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { formatFailure } from "./common.js"
import { ACCESS_VALUES, MODULES, type Access, type Config, type Module } from "./contract.js"

const absolute = z.string().max(4096).refine(isAbsolute, "must be an absolute path")
const ConfigSchema = z.strictObject({
  modules: z.strictObject({ weather: z.boolean().optional(), time: z.boolean().optional(), speech: z.boolean().optional() }).optional(),
  stateRoot: absolute.optional(),
  speech: z.strictObject({ assetsDir: absolute.optional() }).optional(),
  allowUntestedHost: z.boolean().optional(),
  access: z.enum(ACCESS_VALUES).optional(),
}) satisfies z.ZodType<Config>

export interface ResolvedConfig {
  readonly modules: { readonly [M in Module]: boolean }
  readonly stateRoot: string
  readonly cacheRoot: string
  readonly speechAssetsDir?: string
  readonly allowUntestedHost: boolean
  /** What the generated default rules allow: everything, changes ask, or read-only. */
  readonly access: Access
}

/** Validates the plugin options. An invalid option fails setup with every offending key named, never its value. */
export function loadConfig(options: unknown, env: Readonly<Record<string, string | undefined>> = process.env): ResolvedConfig {
  const parsed = ConfigSchema.safeParse(options ?? {})
  if (!parsed.success) {
    const problems = parsed.error.issues.flatMap(issue => {
      const path = ["options", ...issue.path.map(String)].join(".")
      return issue.code === "unrecognized_keys" ? issue.keys.map(key => `${path}.${key} is not a Utilities option`) : [`${path} ${issue.message.replace(/^Invalid input: /, "is invalid: ")}`]
    })
    throw new Error(formatFailure({ code: "OPTIONS_INVALID", message: `The plugin options are invalid: ${problems.join("; ")}.`, hint: "Fix the Utilities plugin options in opencode.json (see Configure in the README), then restart OpenCode." }))
  }
  const value = parsed.data
  const xdg = (name: string, fallback: string) => { const dir = env[name]; return dir && isAbsolute(dir) ? dir : join(homedir(), fallback) }
  return {
    modules: Object.fromEntries(MODULES.map(m => [m, value.modules?.[m] ?? true])) as { [M in Module]: boolean },
    stateRoot: value.stateRoot ?? join(xdg("XDG_DATA_HOME", ".local/share"), "opencode-utilities"),
    cacheRoot: join(xdg("XDG_CACHE_HOME", ".cache"), "opencode-utilities"),
    ...(value.speech?.assetsDir ? { speechAssetsDir: value.speech.assetsDir } : {}),
    allowUntestedHost: value.allowUntestedHost ?? false,
    access: value.access ?? "all",
  }
}
