import { mkdir, rmdir, lstat } from "node:fs/promises"
import { setTimeout } from "node:timers/promises"
import { fence, fail } from "../domain/common.js"

/**
 * Atomic mkdir serializes work across host processes. Without `staleAfter` a lock is never stolen: elapsed time is
 * not proof its owner stopped writing (timer stores). With it, a lock older than its owner's hard deadline is taken
 * over; use that only for idempotent work (verified downloads).
 */
export async function withLock<T>(path: string, signal: AbortSignal, body: () => Promise<T>, staleAfter?: number): Promise<T> {
  for (;;) {
    fence(signal)
    try { await mkdir(path, { mode: 0o700 }); break }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      try {
        const stat = await lstat(path)
        if (!stat.isDirectory() || stat.isSymbolicLink()) fail("UNSAFE_PATH")
        if (staleAfter !== undefined && Date.now() - stat.mtimeMs > staleAfter) { await rmdir(path).catch(() => undefined); continue }
      } catch (inspectError) { if ((inspectError as NodeJS.ErrnoException).code === "ENOENT") continue; throw inspectError }
      await setTimeout(25, undefined, { signal }).catch(() => fence(signal))
    }
  }
  try { fence(signal); return await body() } finally { await rmdir(path) }
}
