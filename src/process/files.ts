import { constants, type Stats } from "node:fs"
import { open, lstat, mkdir, mkdtemp, readdir, realpath, rm } from "node:fs/promises"
import { resolve, parse as pathParse, join } from "node:path"
import { createHash } from "node:crypto"
import { fail, fence } from "../domain/common.js"

/** A file's identity. A changed identity means changed bytes may be behind the same path. */
export interface Identity { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number }
export const identity = (s: Stats): Identity => ({ dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs, ctimeMs: s.ctimeMs })
export const sameIdentity = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs

/** The one path-component walker: visits every component from the root down, with its lstat. */
async function walk(path: string, visit: (component: string, info: Stats | undefined) => Promise<void> | void) {
  const absolute = resolve(path), root = pathParse(absolute).root
  let cursor = root
  for (const part of absolute.slice(root.length).split("/").filter(Boolean)) {
    cursor = join(cursor, part)
    let info: Stats | undefined
    try { info = await lstat(cursor) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    await visit(cursor, info)
  }
  return absolute
}
/** Rejects a symbolic link in any existing component. Missing components are allowed. */
export const noSymlinks = (path: string) => walk(path, (_, info) => { if (info?.isSymbolicLink()) fail("UNSAFE_PATH") })
/** Creates missing components 0700, rejects links, and requires the final directory to be private to this user. */
export async function privateDirectory(path: string) {
  const absolute = await walk(path, async (component, info) => {
    if (!info) {
      try { await mkdir(component, { mode: 0o700 }) } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
      info = await lstat(component)
    }
    if (!info.isDirectory() || info.isSymbolicLink()) fail("UNSAFE_PATH")
  })
  const info = await lstat(absolute)
  if ((info.mode & 0o777) !== 0o700 || info.uid !== process.getuid?.()) fail("STATE_NOT_PRIVATE")
  return absolute
}
// A pathname-scoped lock cannot serialize another scope's hardlinked SQLite inode.
// Inspect without opening: FIFOs/devices must not reach SQLite, even for a read.
export async function sqliteFiles(store: string) {
  await noSymlinks(store)
  for (const file of ["timers.db", "timers.db-wal", "timers.db-shm", "timers.db-journal"]) {
    try {
      const info = await lstat(join(store, file))
      if (!info.isFile() || info.nlink !== 1) fail("STATE_FILE_UNSAFE")
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  }
}
export async function stage(root: string, signal: AbortSignal) {
  fence(signal); await privateDirectory(root); fence(signal)
  const path = await mkdtemp(join(root, "job-"))
  if (signal.aborted) { await rm(path, { recursive: true, force: true }); fence(signal) }
  return path
}
/**
 * Reads a regular, singly linked file without following a final symbolic link. When `expected` is given, the
 * open file must have that identity. The identity is checked again after reading.
 */
export async function readRegular(path: string, max: number, signal?: AbortSignal, expected?: Identity) {
  if (signal) fence(signal)
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.nlink !== 1 || before.size > max) fail("FILE_REJECTED")
    if (expected && !sameIdentity(identity(before), expected)) fail("FILE_CHANGED")
    const bytes = Buffer.alloc(before.size)
    let offset = 0
    while (offset < bytes.length) {
      if (signal) fence(signal)
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (!bytesRead) fail("FILE_CHANGED")
      offset += bytesRead
    }
    const after = await handle.stat(), current = await lstat(path)
    if (!sameIdentity(identity(before), identity(after)) || before.dev !== current.dev || before.ino !== current.ino) fail("FILE_CHANGED")
    if (signal) fence(signal)
    return bytes
  } finally { await handle.close() }
}
/** Hashes a regular file and returns the identity the hash belongs to. Fails if the file changes meanwhile. */
export async function hashRegular(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const before = await handle.stat()
    if (!before.isFile() || before.size > 512 * 1024 * 1024) fail("INTEGRITY_MISMATCH")
    const hash = createHash("sha256"), buffer = Buffer.alloc(65536)
    let offset = 0
    while (offset < before.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset)
      if (!bytesRead) fail("INTEGRITY_MISMATCH")
      hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead
    }
    const after = await handle.stat(), now = await lstat(path)
    if (!sameIdentity(identity(before), identity(after)) || before.ino !== now.ino || before.dev !== now.dev) fail("INTEGRITY_MISMATCH")
    return { sha256: hash.digest("hex"), identity: identity(before) }
  } finally { await handle.close() }
}
export async function removeOwned(path: string, parent: string) {
  await noSymlinks(parent)
  if (resolve(path) === resolve(parent) || !resolve(path).startsWith(`${await realpath(parent)}/`)) fail("UNSAFE_CLEANUP")
  await rm(path, { recursive: true, force: true })
}
/**
 * Removes entries of a plugin-owned directory whose name matches and whose mtime is older than `age` ms. Never
 * creates the directory, never follows links, and skips anything that is not a plain owned entry.
 */
export async function sweep(directory: string, match: RegExp, age: number, kind: "file" | "directory") {
  let entries: string[]
  try { await noSymlinks(directory); entries = await readdir(directory) }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error }
  const cutoff = Date.now() - age
  for (const name of entries.filter(name => match.test(name))) {
    const path = join(directory, name), info = await lstat(path).catch(() => undefined)
    if (!info || info.uid !== process.getuid?.() || info.mtimeMs >= cutoff) continue
    if (kind === "directory" && info.isDirectory()) await removeOwned(path, directory)
    else if (kind === "file" && info.isFile() && info.nlink === 1) await rm(path, { force: true })
  }
}
