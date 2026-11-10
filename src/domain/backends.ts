import * as z from "zod"
import { lstat } from "node:fs/promises"
import { hashRegular, identity, noSymlinks, readRegular, sameIdentity, type Identity } from "../process/files.js"
import { cachePath, installNative, NativeError, readNativeManifest, type NativeCode, type NativeManifest } from "../process/install.js"
import { fail, UtilitiesError } from "./common.js"
import { PLATFORMS, type FailureCode, type NativeBinary, type Platform } from "./contract.js"

export const sha256 = z.string().regex(/^[a-f0-9]{64}$/)
export const platformKey = z.enum(Object.keys(PLATFORMS) as [Platform, ...Platform[]])

/** The running platform as a PLATFORMS key. Linux builds target glibc; a musl system has no build to load. */
export function detectTarget() {
  return process.platform === "linux" ? `linux-${process.arch}-gnu` : `${process.platform}-${process.arch}`
}
export const isPlatform = (target: string): target is Platform => Object.hasOwn(PLATFORMS, target)

/**
 * Reads a JSON file that ships in the installed package. A file that is not there is NATIVE_FILES_MISSING, not a
 * contract mismatch: a checkout without its speech manifest cannot run speech.
 */
export async function packageJson(path: string, max = 65536): Promise<unknown> {
  try { await noSymlinks(path); return JSON.parse((await readRegular(path, max)).toString("utf8")) }
  catch (error) {
    if (error instanceof UtilitiesError && error.code === "UNSAFE_PATH") throw error
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fail("NATIVE_FILES_MISSING")
    return fail("CONTRACT_MISMATCH")
  }
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

/** The native code a refusal from the shared installer becomes here, with its own message and next step. */
const FAILURES: Readonly<Record<NativeCode, FailureCode>> = {
  NATIVE_MANIFEST_MISSING: "NATIVE_FILES_MISSING",
  NATIVE_MANIFEST_INVALID: "CONTRACT_MISMATCH",
  NATIVE_UNSUPPORTED_PLATFORM: "UNSUPPORTED_PLATFORM",
  NATIVE_NOT_INSTALLED: "NATIVE_FILES_MISSING",
  NATIVE_NETWORK: "DOWNLOAD_FAILED",
  NATIVE_NOT_FOUND: "DOWNLOAD_FAILED",
  NATIVE_HASH_MISMATCH: "INTEGRITY_MISMATCH",
  NATIVE_SIZE_MISMATCH: "INTEGRITY_MISMATCH",
  NATIVE_STALLED: "DOWNLOAD_FAILED",
  NATIVE_CANCELLED: "CANCELLED",
  NATIVE_WRITE_FAILED: "DOWNLOAD_FAILED",
}

function refuse(error: unknown): never {
  if (error instanceof NativeError) return fail(FAILURES[error.code], { message: error.message.replace(/^NATIVE_[A-Z_]+: /, ""), hint: error.next })
  throw error
}

/** A verified executable: its path, and the sha256 every spawn checks it against. */
export interface NativeExecutable { readonly path: string; readonly sha256: string }

/**
 * The time and weather programs, from the release manifest (manifest/native.json) and the plugin's cache. A program
 * is downloaded only by `install`, which the caller reaches after its permission check, so a read never downloads.
 */
export class NativeBinaries {
  private manifest: Promise<NativeManifest> | undefined
  constructor(private readonly options: { readonly packageRoot: string; readonly cacheRoot: string; readonly target: string }) {}

  /** The release manifest, read once while it works. A failure is not kept, so a fixed checkout answers on the next call. */
  private release(): Promise<NativeManifest> {
    this.manifest ??= readNativeManifest(this.options.packageRoot)
      .then(raw => raw ?? refuse(new NativeError(
        "NATIVE_MANIFEST_MISSING",
        "this copy of the plugin has no release manifest, so it names no time or weather program",
        "Run npm run native:ensure in a checkout, or install a release of the plugin.",
      )))
      .catch(error => { this.manifest = undefined; return refuse(error) })
    return this.manifest
  }

  private optionsFor(release: NativeManifest, module: NativeBinary) {
    return { manifest: release, module, key: this.options.target, cacheRoot: this.options.cacheRoot, installCommand: "/utilities-install" }
  }

  /** Whether this platform has a build in the release. Fails with UNSUPPORTED_PLATFORM or NATIVE_FILES_MISSING. */
  async platform(): Promise<void> {
    if (!isPlatform(this.options.target)) fail("UNSUPPORTED_PLATFORM")
    const release = await this.release()
    if (!release.modules["time-keep"]?.[this.options.target]) fail("UNSUPPORTED_PLATFORM")
  }

  /**
   * The verified program when it is already cached; undefined when it must be downloaded first (missing, or not the
   * pinned bytes: a download replaces it, after its permission check). A link is UNSAFE_PATH. Downloads nothing.
   * The shared verifier hashes a file once per identity, so a call re-hashes nothing while the file is unchanged.
   */
  async cached(module: NativeBinary): Promise<NativeExecutable | undefined> {
    const release = await this.release()
    const sha256 = release.modules[module]?.[this.options.target]?.executable.sha256
    if (sha256 === undefined) fail("UNSUPPORTED_PLATFORM")
    const path = cachePath(this.optionsFor(release, module))
    const state = await verifier.check(path, sha256, true)
    if (state === "unsafe") fail("UNSAFE_PATH")
    return state === "verified" ? { path, sha256 } : undefined
  }

  /** The verified program, downloaded now if it is not cached. Only after the caller's permission check. */
  async install(module: NativeBinary, signal?: AbortSignal): Promise<NativeExecutable> {
    const release = await this.release()
    const { path } = await installNative({ ...this.optionsFor(release, module), signal }).catch(refuse)
    return { path, sha256: release.modules[module]![this.options.target]!.executable.sha256 }
  }
}

