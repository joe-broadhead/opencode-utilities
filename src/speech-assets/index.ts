import * as z from "zod"
import { rmdir } from "node:fs/promises"
import { join } from "node:path"
import { fail, fence, parse, deadline } from "../domain/common.js"
import { isPlatform, packageJson, platformKey, sha256, verifier } from "../domain/backends.js"
import { privateDirectory } from "../process/files.js"
import { withLock } from "../process/lock.js"
import { SPEECH_DOWNLOAD_ACTION, SPEECH_MODEL_ROLES, type PermissionRequest, type SpeechAsset, type SpeechAssetManifest, type SpeechAssetRole, type StatusView } from "../domain/contract.js"
import { download } from "./download.js"

const loopback = new Set(["127.0.0.1", "localhost", "[::1]"])
const asset = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/),
  // Release assets are fetched over HTTPS; plain HTTP is accepted only from a loopback mirror.
  url: z.string().max(2048).refine(value => { try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" && loopback.has(url.hostname) } catch { return false } }),
  sha256,
  bytes: z.number().int().positive().max(512 * 1024 * 1024),
})
const manifestSchema = z.strictObject({
  engines: z.partialRecord(platformKey, asset),
  models: z.strictObject({ "tiny-q5_1": asset, "kitten-model": asset, "kitten-voices": asset, "kitten-config": asset }),
}).refine(m => {
  const names = [...Object.values(m.engines), ...Object.values(m.models)].map(a => a!.name)
  return new Set(names).size === names.length
}) satisfies z.ZodType<SpeechAssetManifest>

/** The Kitten nano voices of the pinned engine (aurum 8e3b70f catalogue), and its default. */
export const VOICES = ["Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo"] as const
export const DEFAULT_VOICE = "Luna"
/** The files each engine operation needs. Cleanup needs none: it is plain TypeScript. */
export const SPEECH_ROLES = {
  transcribe: ["engine", "tiny-q5_1"],
  synthesize: ["engine", "kitten-model", "kitten-voices", "kitten-config"],
} as const satisfies Record<string, readonly SpeechAssetRole[]>
/** A whole install can take this long; a download lock older than this (plus a margin) belongs to a dead process. */
const INSTALL_DEADLINE = 30 * 60_000

type AssetState = StatusView["speech"]["assets"][number]["state"]
export interface Entry { readonly role: SpeechAssetRole; readonly asset: SpeechAsset; readonly path: string; readonly state: AssetState }

/**
 * Speech engine and model files, from the manifest shipped in the package. Downloads go to the content-addressed
 * cache `<cacheRoot>/<sha256>/<name>`. With `assetsDir`, files are taken from `<assetsDir>/<name>` (or the cache)
 * and nothing is ever downloaded. Every file is verified against its pinned hash before use.
 */
export class SpeechAssets {
  private manifest: Promise<SpeechAssetManifest> | undefined
  constructor(private readonly options: { packageRoot: string; cacheRoot: string; assetsDir?: string; target: string }) {}
  get cacheRoot() { return this.options.cacheRoot }
  get preseeded() { return this.options.assetsDir !== undefined }
  /** The assets for this platform, by role. Fails with UNSUPPORTED_PLATFORM when no engine is built for it. */
  async assets(): Promise<ReadonlyMap<SpeechAssetRole, SpeechAsset>> {
    this.manifest ??= packageJson(join(this.options.packageRoot, "manifest/speech-assets.json")).then(raw => parse(manifestSchema, raw))
    const manifest = await this.manifest, { target } = this.options
    const engine = isPlatform(target) ? manifest.engines[target] : undefined
    if (!engine) fail("UNSUPPORTED_PLATFORM", { message: "The speech engine has no build for this platform.", hint: "Time and weather tools are unaffected. Call utilities_status for details." })
    return new Map<SpeechAssetRole, SpeechAsset>([["engine", engine], ...SPEECH_MODEL_ROLES.map(role => [role, manifest.models[role]] as const)])
  }
  private cached(a: SpeechAsset) { return join(this.options.cacheRoot, a.sha256, a.name) }
  /** Each requested file with where it was found and verified, or `missing`. */
  async inspect(roles: readonly SpeechAssetRole[]): Promise<Entry[]> {
    const assets = await this.assets()
    return Promise.all(roles.map(async role => {
      const a = assets.get(role)!, executable = role === "engine"
      // A link is refused as UNSAFE_PATH, never treated as a missing or altered file.
      if (this.options.assetsDir !== undefined) {
        const path = join(this.options.assetsDir, a.name), result = await verifier.check(path, a.sha256, executable)
        if (result === "unsafe") fail("UNSAFE_PATH")
        if (result === "verified") return { role, asset: a, path, state: "pre-seeded" as const }
      }
      const path = this.cached(a), result = await verifier.check(path, a.sha256, executable)
      if (result === "unsafe") fail("UNSAFE_PATH")
      return { role, asset: a, path, state: result === "verified" ? "cached" as const : "missing" as const }
    }))
  }
  /** The download request for `missing` files: resource and save are the release hosts; metadata carries the size. */
  request(missing: readonly Entry[]): PermissionRequest {
    const hosts = [...new Set(missing.map(e => new URL(e.asset.url).host))]
    return { action: SPEECH_DOWNLOAD_ACTION, resources: hosts, save: hosts, metadata: { bytes: missing.reduce((n, e) => n + e.asset.bytes, 0), files: missing.map(e => e.asset.name) } }
  }
  /** Fails for missing files when pre-seeding is configured, because pre-seeded installs never download. */
  requireDownloadable(missing: readonly Entry[]) {
    if (missing.length && this.preseeded) fail("SPEECH_ASSETS_MISSING", { message: `The speech files ${missing.map(e => e.asset.name).join(", ")} are missing from speech.assetsDir, or do not match their pinned hashes.`, hint: "Copy the files listed in the plugin's manifest/speech-assets.json into speech.assetsDir. The engine file must be executable." })
  }
  /**
   * Downloads the missing files, one at a time, each under a cross-instance lock. A file another process finished
   * meanwhile is verified and kept. Returns the files this call downloaded.
   */
  async download(missing: readonly Entry[], signal: AbortSignal): Promise<Entry[]> {
    this.requireDownloadable(missing)
    const limit = deadline(INSTALL_DEADLINE), work = AbortSignal.any([signal, limit.signal]), downloaded: Entry[] = []
    try {
      for (const entry of missing) {
        const target = this.cached(entry.asset), directory = join(this.options.cacheRoot, entry.asset.sha256)
        await privateDirectory(directory); fence(work)
        try {
          await withLock(join(directory, ".lock"), work, async () => {
            if (await verifier.check(target, entry.asset.sha256, entry.role === "engine") === "verified") return
            await download(entry.asset, target, entry.role === "engine" ? 0o700 : 0o600, work)
            if (await verifier.check(target, entry.asset.sha256, entry.role === "engine") !== "verified") fail("INTEGRITY_MISMATCH")
            downloaded.push({ ...entry, path: target, state: "cached" })
          }, INSTALL_DEADLINE + 60_000)
        } catch (error) {
          // A failed download leaves no empty folder behind. rmdir only removes an empty one, so another process's lock or file stays.
          await rmdir(directory).catch(() => undefined)
          throw error
        }
      }
    } finally { limit.clear() }
    return downloaded
  }
}
