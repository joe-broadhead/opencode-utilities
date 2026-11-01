import { access } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path"
import type { EffectiveToolName, PermissionRequest, ProjectLocation } from "../domain/contract.js"

/** A file path resolved the way the host's own file tools resolve it (anomalyco/opencode@v2.2.3 FileAccess.resolve). */
export interface FileAccess {
  readonly absolute: string
  /** Relative to the location directory when inside the location or project directory; otherwise the absolute path. */
  readonly resource: string
  /** Present outside both: `<dir>/*`, saved as `<repository root of dir, or dir>/*`. */
  readonly external?: { readonly resource: string; readonly save: string }
}
const contains = (parent: string, child: string) => {
  const path = relative(parent, child)
  return path === "" || !isAbsolute(path) && path !== ".." && !path.startsWith("../")
}
const slashes = (path: string) => path.replaceAll("\\", "/")
const exists = (path: string) => access(path).then(() => true, () => false)
async function repositoryRoot(directory: string) {
  for (let cursor = directory; ; cursor = dirname(cursor)) {
    for (const marker of [".git", ".hg"]) if (await exists(join(cursor, marker))) return cursor
    if (dirname(cursor) === cursor) return undefined
  }
}
/**
 * Resolves a file path (`~` expanded) against the location directory. A file under the project directory is inside
 * as well, unless the project directory is the filesystem root.
 */
export async function fileAccess({ directory, projectDirectory }: Pick<ProjectLocation, "directory" | "projectDirectory">, path: string): Promise<FileAccess> {
  const home = homedir(), project = resolve(projectDirectory)
  const absolute = resolve(directory, path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path)
  if (contains(directory, absolute) || project !== parse(project).root && contains(project, absolute)) return { absolute, resource: slashes(relative(directory, absolute) || ".") }
  const parent = dirname(absolute)
  return { absolute, resource: slashes(absolute), external: { resource: slashes(join(parent, "*")), save: slashes(join(await repositoryRoot(parent) ?? parent, "*")) } }
}
const external = (file: FileAccess): PermissionRequest[] => file.external ? [{ action: "external_directory", resources: [file.external.resource], save: [file.external.save] }] : []

/** read-file: `external_directory` first when outside the location and project, then the host's `read`. */
export const readRequests = (file: FileAccess): PermissionRequest[] => [...external(file), { action: "read", resources: [file.resource], save: ["*"] }]
/** write-file: the tool's own action (resource: model and voice), then `external_directory` and `edit` for a given path. */
export const synthesisRequests = (voice: string, characters: number, file?: FileAccess): PermissionRequest[] => [
  { action: "utilities_speech_synthesize", resources: [`kitten-nano-int8/${voice}`], save: ["*"], metadata: { voice, characters } },
  ...file ? [...external(file), { action: "edit" as const, resources: [file.resource], save: ["*"] }] : [],
]
/** write-state: `timer:<name>`, saved for every timer. */
export const timerRequest = (action: Extract<EffectiveToolName, "utilities_timer_set" | "utilities_timer_delete">, name: string): PermissionRequest =>
  ({ action, resources: [`timer:${name}`], save: ["timer:*"] })
/** network: the provider hosts the call contacts, saved under the same hosts. */
export const weatherRequest = (action: WeatherAction, hosts: readonly string[], location: string): PermissionRequest =>
  ({ action, resources: hosts, save: hosts, metadata: { location } })
export type WeatherAction = Extract<EffectiveToolName, `utilities_weather_${string}`>
