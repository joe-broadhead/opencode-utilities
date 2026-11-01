import { test, expect, afterEach } from "vitest"
import { writeFile, mkdtemp, mkdir, rm, readFile, readdir, symlink, utimes, chmod } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { realpath } from "node:fs/promises"
import { run, BackendFailure } from "../../src/process/run.js"
import { withLock } from "../../src/process/lock.js"
import { Queue } from "../../src/process/queue.js"
import { noSymlinks, privateDirectory, sweep } from "../../src/process/files.js"
import { LIMITS, deadline } from "../../src/domain/common.js"

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const fn of cleanups.reverse()) await fn(); cleanups.length = 0 })
async function scratch(prefix: string) {
  const root = await mkdtemp(join(await realpath(tmpdir()), prefix)); cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}
async function until(check: () => Promise<boolean>, ms = 15000) {
  const end = Date.now() + ms
  while (!await check()) { if (Date.now() > end) throw new Error("condition not reached"); await new Promise(r => setTimeout(r, 10)) }
}
const exists = (path: string) => readFile(path).then(() => true, () => false)
const rejection = (work: Promise<unknown>) => work.then(() => { throw new Error("expected a failure") }, (error: BackendFailure) => error)
// Child start-up can take seconds on a loaded machine, so no limit below is measured from spawn: limits are generous
// where the child ends by itself, and cancellation is triggered only after the child is observed running.
async function child(code: string, signal = AbortSignal.timeout(30000)) {
  const root = await scratch("utilities-process-"), file = join(root, "child.cjs"); await writeFile(file, code)
  return run({ executable: process.execPath, args: [file], cwd: root, signal })
}

test.each([
  ["stdout overflow", "process.stdout.write('x'.repeat(1048577));setInterval(()=>{},1000)", "STDOUT_LIMIT"],
  ["stderr overflow", "process.stderr.write('x'.repeat(65537));setInterval(()=>{},1000)", "STDERR_LIMIT"],
  ["invalid UTF8", "process.stdout.write(Buffer.from([0xff]))", "BACKEND_JSON_INVALID"],
  ["malformed JSON", "process.stdout.write('private malformed payload')", "BACKEND_JSON_INVALID"],
])("supervision rejects %s without leaking output", async (_name, code, expected) => {
  const error = await rejection(child(code))
  expect(error.code).toBe(expected); expect(error.message).not.toContain("private")
})
test("a nonzero exit is BACKEND_FAILED with the stderr JSON kept off the message", async () => {
  const error = await rejection(child("process.stderr.write(JSON.stringify({error:'private failure'}));process.exit(1)"))
  expect(error).toBeInstanceOf(BackendFailure); expect(error.code).toBe("BACKEND_FAILED")
  expect(error.report).toEqual({ error: "private failure" }); expect(error.message).not.toContain("private"); expect(error.hint).toBeTruthy()
})
test("a running child is stopped as CANCELLED by the tool signal and as DEADLINE_EXCEEDED by the deadline", async () => {
  const root = await scratch("utilities-abort-"), file = join(root, "child.cjs"); await writeFile(file, "setInterval(()=>{},1000)")
  const cancel = new AbortController()
  await expect(run({ executable: process.execPath, args: [file], cwd: root, signal: cancel.signal, onSpawn: () => cancel.abort() })).rejects.toMatchObject({ code: "CANCELLED" })
  // The deadline is armed once the child runs; its abort reason is forwarded as the call's own deadline would be.
  const forward = new AbortController()
  const armed = () => { const limit = deadline(1); limit.signal.addEventListener("abort", () => forward.abort(limit.signal.reason)) }
  await expect(run({ executable: process.execPath, args: [file], cwd: root, signal: forward.signal, onSpawn: armed })).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED" })
})
test("aborted call starts no child", async () => {
  const controller = new AbortController(); controller.abort()
  await expect(run({ executable: "/nonexistent", args: [], cwd: "/", signal: controller.signal })).rejects.toMatchObject({ code: "CANCELLED" })
})
test("owned descendants are killed and pipes reaped on cancellation", async () => {
  const root = await scratch("utilities-tree-"), pidFile = join(root, "pid"), script = join(root, "parent.cjs")
  await writeFile(script, `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000)`)
  const controller = new AbortController()
  const work = run({ executable: process.execPath, args: [script], cwd: root, signal: controller.signal })
  await until(() => exists(pidFile)); controller.abort()
  await expect(work).rejects.toMatchObject({ code: "CANCELLED" })
  const pid = Number(await readFile(pidFile, "utf8"))
  // The group is SIGKILLed when the parent closes. Linux may keep a reaped-by-init zombie briefly; it cannot run work.
  const gone = async () => {
    try { process.kill(pid, 0) } catch { return true }
    return process.platform === "linux" && /\) Z /.test(await readFile(`/proc/${pid}/stat`, "utf8").catch(() => ") Z "))
  }
  await until(gone, 5000)
})
test("a cross-process lock cannot be entered while another process owns it, and is never stolen by default", async () => {
  const root = await scratch("utilities-lock-"), lock = join(root, "lock"), marker = join(root, "held"), release = join(root, "release")
  // The owner holds the lock until told to release it, so no timing depends on its start-up.
  const owner = spawn(process.execPath, ["-e", `const fs=require('node:fs');fs.mkdirSync(${JSON.stringify(lock)});fs.writeFileSync(${JSON.stringify(marker)},'1');const t=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){fs.rmdirSync(${JSON.stringify(lock)});clearInterval(t)}},10)`])
  const closed = new Promise<void>((resolve, reject) => { owner.on("error", reject); owner.on("close", () => resolve()) })
  await until(() => exists(marker))
  await utimes(lock, new Date(0), new Date(0))
  let entered = false
  await expect(withLock(lock, AbortSignal.timeout(100), async () => { entered = true })).rejects.toMatchObject({ code: "CANCELLED" })
  expect(entered).toBe(false)
  await writeFile(release, "1"); await closed
  await withLock(lock, AbortSignal.timeout(30000), async () => { entered = true }); expect(entered).toBe(true)
  await expect(readdir(root)).resolves.not.toContain("lock")
})
test("a lock older than its owner's deadline is taken over only when the caller allows it", async () => {
  const root = await scratch("utilities-stale-"), lock = join(root, "lock")
  await mkdir(lock); await utimes(lock, new Date(Date.now() - 120000), new Date(Date.now() - 120000))
  let entered = false
  await withLock(lock, AbortSignal.timeout(30000), async () => { entered = true }, 60000)
  expect(entered).toBe(true)
  await mkdir(lock)
  await expect(withLock(lock, AbortSignal.timeout(100), async () => {}, 60000)).rejects.toMatchObject({ code: "CANCELLED" })
})
test("each module has its own waiting bound, and cancellation reclaims waiting slots", async () => {
  const queue = new Queue(), never = new AbortController().signal, controller = new AbortController()
  const active = await queue.acquire("speech", never)
  const waiting = Array.from({ length: LIMITS.queued.speech }, () => queue.acquire("speech", controller.signal).catch(e => e.code))
  await expect(queue.acquire("speech", never)).rejects.toMatchObject({ code: "QUEUE_FULL" })
  // A full speech queue does not refuse time calls.
  const time = await queue.acquire("time", never); time()
  controller.abort(); expect(await Promise.all(waiting)).toEqual(Array(LIMITS.queued.speech).fill("CANCELLED")); active()
  const release = await queue.acquire("speech", never); release()
})
test("a released slot passes to the next waiter of the same module", async () => {
  const queue = new Queue(), never = new AbortController().signal
  const first = await queue.acquire("speech", never)
  let admitted = false
  const second = queue.acquire("speech", never).then(release => { admitted = true; return release })
  await new Promise(r => setImmediate(r)); expect(admitted).toBe(false)
  first(); (await second)(); expect(admitted).toBe(true)
  const third = await queue.acquire("speech", never); third()
})
test("one walker checks components: links are rejected, missing components are allowed, private directories are created 0700", async () => {
  const root = await scratch("utilities-walk-"), target = join(root, "target"), link = join(root, "link")
  await mkdir(target); await symlink(target, link)
  await expect(noSymlinks(join(link, "missing"))).rejects.toMatchObject({ code: "UNSAFE_PATH" })
  await expect(noSymlinks(join(root, "missing", "child"))).resolves.toBe(join(root, "missing", "child"))
  await expect(privateDirectory(join(link, "state"))).rejects.toMatchObject({ code: "UNSAFE_PATH" })
  expect(await readdir(target)).toEqual([])
  const state = await privateDirectory(join(root, "a", "b"))
  await chmod(state, 0o755); await expect(privateDirectory(state)).rejects.toMatchObject({ code: "STATE_NOT_PRIVATE" })
})
test("the sweep removes only old matching entries it owns, and never follows links", async () => {
  const root = await scratch("utilities-sweep-"), jobs = join(root, "jobs"), old = new Date(Date.now() - 3600000), outside = join(root, "outside")
  await mkdir(join(jobs, "job-old"), { recursive: true }); await writeFile(join(jobs, "job-old", "input.wav"), "x"); await utimes(join(jobs, "job-old"), old, old)
  await mkdir(join(jobs, "job-fresh")); await mkdir(join(jobs, "other")); await utimes(join(jobs, "other"), old, old)
  await mkdir(outside); await symlink(outside, join(jobs, "job-link"))
  await sweep(jobs, /^job-/, 600000, "directory")
  expect((await readdir(jobs)).sort()).toEqual(["job-fresh", "job-link", "other"])
  await expect(sweep(join(root, "absent"), /^job-/, 0, "directory")).resolves.toBeUndefined()
})
