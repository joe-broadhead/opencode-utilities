import * as z from "zod"
import { lstat, realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { hashRegular, identity, noSymlinks, readRegular, sameIdentity, type Identity } from "../process/files.js"
import { fail, parse, UtilitiesError } from "./common.js"
import { PLATFORMS, type BackendManifest, type Platform, type PlatformModule, type PlatformPackage } from "./contract.js"

export const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
export const platformKey = z.enum(Object.keys(PLATFORMS) as [Platform, ...Platform[]])
const entry = z.strictObject({ path: z.string().max(256).regex(/^bin\/[A-Za-z0-9_.-]+$/), sha256 })
const manifestSchema = z.strictObject({ platforms: z.partialRecord(platformKey, z.strictObject({ time: entry, weather: entry })) }) satisfies z.ZodType<BackendManifest>

/** The running platform as a PLATFORMS key. Linux packages target glibc; a musl system finds no package to load. */
export function detectTarget() {
  return process.platform === "linux" ? `linux-${process.arch}-gnu` : `${process.platform}-${process.arch}`
}
export const isPlatform = (target: string): target is Platform => Object.hasOwn(PLATFORMS, target)

/** Reads a JSON file that ships in the installed package. */
export async function packageJson(path: string, max = 65536): Promise<unknown> {
  try { await noSymlinks(path); return JSON.parse((await readRegular(path, max)).toString("utf8")) }
  catch (error) { if (error instanceof UtilitiesError && error.code === "UNSAFE_PATH") throw error; return fail("CONTRACT_MISMATCH") }
}

/**
 * Verifies files against pinned SHA-256 hashes once per process. A result is cached by path and file identity
 * (dev, ino, size, mtimeMs, ctimeMs); any change to the file re-hashes it. Symbolic links are never accepted: a link
 * is `unsafe`, which callers report as UNSAFE_PATH, never as an integrity failure. Pass paths under resolved roots.
 */
class Verifier {
  private verified = new Map<string, Identity & { sha256: string }>()
  private hashing = new Map<string, Promise<"verified" | "mismatch">>()
  digest(path: string) { return hashRegular(path) }
  async check(path: string, expected: string, executable: boolean): Promise<"verified" | "missing" | "mismatch" | "unsafe"> {
    let info
    try { await noSymlinks(path); info = await lstat(path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"
      if (error instanceof UtilitiesError && error.code === "UNSAFE_PATH") return "unsafe"
      if (error instanceof UtilitiesError) return "mismatch"
      throw error
    }
    if (info.isSymbolicLink()) return "unsafe"
    if (!info.isFile() || executable && !(info.mode & 0o111)) return "mismatch"
    const cached = this.verified.get(path)
    if (cached && cached.sha256 === expected && sameIdentity(cached, identity(info))) return "verified"
    // Concurrent first checks of one file share a single hash.
    const key = `${expected}:${path}`
    let hashing = this.hashing.get(key)
    if (!hashing) {
      this.verified.delete(path)
      hashing = this.digest(path).then(digest => {
        if (digest.sha256 !== expected) return "mismatch" as const
        this.verified.set(path, { ...digest.identity, sha256: expected })
        return "verified" as const
      }, () => "mismatch" as const).finally(() => this.hashing.delete(key))
      this.hashing.set(key, hashing)
    }
    return hashing
  }
}
/** The one integrity cache for this process. */
export const verifier = new Verifier()

/** Time and weather binaries from the per-platform optional npm package. There is no download fallback. */
export class Backends {
  private manifest: Promise<BackendManifest> | undefined
  constructor(private readonly packageRoot: string, private readonly target: string) {}
  /** The platform package name for this target, if the platform is supported. */
  get package(): PlatformPackage | undefined { return isPlatform(this.target) ? PLATFORMS[this.target].package : undefined }
  /** Resolves the platform package root, or fails with UNSUPPORTED_PLATFORM or PLATFORM_PACKAGE_MISSING. */
  async platform(): Promise<{ root: string; entry: NonNullable<BackendManifest["platforms"][Platform]> }> {
    if (!isPlatform(this.target)) fail("UNSUPPORTED_PLATFORM")
    this.manifest ??= packageJson(join(this.packageRoot, "manifest/backends.json")).then(raw => parse(manifestSchema, raw))
    const binaries = (await this.manifest).platforms[this.target]
    if (!binaries) fail("UNSUPPORTED_PLATFORM")
    const name = PLATFORMS[this.target].package
    let root: string
    // Resolved once, like the other roots: npm and pnpm may reach the package through links above it.
    try { root = await realpath(dirname(createRequire(join(this.packageRoot, "package.json")).resolve(`${name}/package.json`))) }
    catch { return fail("PLATFORM_PACKAGE_MISSING") }
    return { root, entry: binaries }
  }
  /** The verified executable for a module, checked against manifest/backends.json, the executable mode and links. */
  async executable(module: PlatformModule) {
    const { root, entry } = await this.platform(), file = entry[module], path = join(root, file.path)
    const result = await verifier.check(path, file.sha256, true)
    if (result === "missing") fail("BINARY_MISSING")
    if (result === "unsafe") fail("UNSAFE_PATH")
    if (result === "mismatch") fail("INTEGRITY_MISMATCH")
    return { path, sha256: file.sha256 }
  }
}
