import { homedir } from "node:os"
import { isAbsolute, join, parse, relative, resolve } from "node:path"
import type { ProjectLocation } from "../domain/contract.js"

/** A file path resolved the way the host's own file tools resolve it: `~` expanded, relative to the location directory. */
export interface FileAccess {
  readonly absolute: string
  /** Relative to the location directory when inside it, otherwise the absolute path. */
  readonly resource: string
}

const contains = (parent: string, child: string) => {
  const path = relative(parent, child)
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith("../"))
}
const slashes = (path: string) => path.replaceAll("\\", "/")

/**
 * Resolves a file path against the location directory. A file under the project directory is inside as well, unless
 * the project directory is the filesystem root.
 */
export async function fileAccess({ directory, projectDirectory }: Pick<ProjectLocation, "directory" | "projectDirectory">, path: string): Promise<FileAccess> {
  const home = homedir()
  const project = resolve(projectDirectory)
  const absolute = resolve(directory, path === "~" ? home : path.startsWith("~/") ? join(home, path.slice(2)) : path)
  const inside = contains(directory, absolute) || (project !== parse(project).root && contains(project, absolute))
  return { absolute, resource: slashes(inside ? relative(directory, absolute) || "." : absolute) }
}
