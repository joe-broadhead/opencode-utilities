import { describe, expect, it } from "vitest"

// The helper is plain Node, shared with the release scripts, so it is loaded at run time rather than typed here.
const { retryFailure, withRetry } = (await import(new URL("../../scripts/retry.mjs", import.meta.url).href)) as {
  retryFailure: (message: string) => never
  withRetry: <T>(task: (attempt: number) => Promise<T>, options?: { attempts?: number; delaysMs?: number[]; pause?: (ms: number) => Promise<void> }) => Promise<T>
}

describe("withRetry, for the native model download", () => {
  it("tries a failed connection again, and returns the first success", async () => {
    const pauses: number[] = []
    const value = await withRetry(
      async (attempt) => {
        if (attempt < 3) retryFailure("connection reset")
        return "ok"
      },
      { pause: async (ms) => void pauses.push(ms) },
    )
    expect(value).toBe("ok")
    expect(pauses).toEqual([2000, 5000])
  })

  it("gives up after the last attempt, with that failure", async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls += 1
          retryFailure("connection reset")
        },
        { pause: async () => {} },
      ),
    ).rejects.toThrow("connection reset")
    expect(calls).toBe(3)
  })

  it("throws at once a failure that is not retryable", async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls += 1
          throw new Error("model integrity failed")
        },
        { pause: async () => {} },
      ),
    ).rejects.toThrow("model integrity failed")
    expect(calls).toBe(1)
  })
})
