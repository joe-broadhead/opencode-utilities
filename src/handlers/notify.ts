import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"

/**
 * Tell every app that something the plugin keeps changed (contract §10). A nudge carries no content, and a lost one
 * costs a re-read, never data: a failed emit is logged nowhere and never fails the write it followed.
 */
export async function notify(call: Pick<MethodCall, "bus" | "account">, capability: string, reason: string): Promise<void> {
  try {
    await call.bus.emit("changed", { capability, account: call.account, reason })
  } catch {
    // The write already happened; the next pull sees it.
  }
}
