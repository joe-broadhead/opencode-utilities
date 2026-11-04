// Live Open-Meteo calls with the real weather-signal, only with UTILITIES_LIVE_WEATHER=1 (CONTRIBUTING). The
// default checks call no network service.
import { afterAll, expect, test } from "vitest"
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRuntime } from "../../src/runtime.js"
import type { Runtime } from "../../src/domain/contract.js"
import { invocation } from "../fixtures.js"

const repo = fileURLToPath(new URL("../../", import.meta.url))
const cleanups: (() => Promise<unknown>)[] = []
afterAll(async () => { for (const c of cleanups.reverse()) await c() })

test.skipIf(process.env.UTILITIES_LIVE_WEATHER !== "1")("the second identical forecast within 30 minutes is a cache hit, even from a new runtime (UTIL-2)", async () => {
  const root = await mkdtemp(join(await realpath(tmpdir()), "utilities-live-")); cleanups.push(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "state"), { mode: 0o700 })
  const open = async () => {
    const runtime: Runtime = await createRuntime({ location: { project: "live", directory: root, projectDirectory: root }, authorize: async () => {}, modules: { time: false, weather: true, speech: false }, stateRoot: join(root, "state"), cacheRoot: join(root, "cache"), packageRoot: repo })
    cleanups.push(() => runtime.close()); return runtime
  }
  const call = async (runtime: Runtime) => ((await runtime.invoke("weather_current", { location: "52.37,4.89" }, invocation())).output as { cache: string }).cache
  expect(await call(await open())).toBe("miss")
  expect(await call(await open())).toBe("hit")
}, 60_000)
