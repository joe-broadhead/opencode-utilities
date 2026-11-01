import { afterEach, describe, expect, test, vi } from "vitest"
import { mkdir, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join, parse } from "node:path"
import { createRuntime } from "../../src/runtime.js"
import { fileAccess, readRequests, synthesisRequests } from "../../src/runtime/permissions.js"
import type { Authorize } from "../../src/domain/contract.js"
import { fixture, invocation, wav } from "../fixtures.js"

const cleanups: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close() })
async function setup() {
  const f = await fixture(); cleanups.push(f.cleanup)
  const outside = join(f.root, "outside"), repository = join(outside, "repository")
  await mkdir(join(repository, ".git"), { recursive: true }); await mkdir(join(repository, "audio"), { recursive: true }); await mkdir(join(outside, "loose"))
  // Without version control the host's project directory is the location directory itself.
  return { ...f, outside, repository, location: { directory: f.project, projectDirectory: f.project } }
}

// Expected values follow anomalyco/opencode@v2.2.3 FileAccess.resolve: a path inside the location directory is a
// location-relative resource; outside it, the resource is the absolute path, plus external_directory on `<dir>/*`,
// saved as `<repository root of dir, or dir>/*`.
describe("file resources match the host format", () => {
  test("inside the location directory, the resource is location-relative", async () => {
    const f = await setup()
    expect(await fileAccess(f.location, "audio/in.wav")).toEqual({ absolute: join(f.project, "audio/in.wav"), resource: "audio/in.wav" })
    expect(await fileAccess(f.location, "./in.wav")).toEqual({ absolute: join(f.project, "in.wav"), resource: "in.wav" })
    expect(await fileAccess(f.location, join(f.project, "deep/in.wav"))).toEqual({ absolute: join(f.project, "deep/in.wav"), resource: "deep/in.wav" })
    expect(await fileAccess(f.location, ".")).toEqual({ absolute: f.project, resource: "." })
  })
  test("outside, the resource is absolute and the external directory is saved at its repository root", async () => {
    const f = await setup(), file = join(f.repository, "audio/in.wav")
    expect(await fileAccess(f.location, file)).toEqual({ absolute: file, resource: file, external: { resource: `${join(f.repository, "audio")}/*`, save: `${f.repository}/*` } })
    expect(await fileAccess(f.location, "../outside/loose/in.wav")).toEqual({ absolute: join(f.outside, "loose/in.wav"), resource: join(f.outside, "loose/in.wav"), external: { resource: `${join(f.outside, "loose")}/*`, save: `${join(f.outside, "loose")}/*` } })
  })
  test("a sibling sharing the directory's name prefix is outside", async () => {
    const f = await setup(), sibling = `${f.project}-other/in.wav`
    expect((await fileAccess(f.location, sibling)).external?.resource).toBe(`${f.project}-other/*`)
  })
  test("~ expands to the home directory", async () => {
    const f = await setup(), access = await fileAccess(f.location, "~/in.wav")
    expect(access.absolute).toBe(join(homedir(), "in.wav")); expect(access.resource).toBe(join(homedir(), "in.wav"))
    expect(access.external?.resource).toBe(`${homedir()}/*`)
  })
})

// The host also counts a file under project.directory as inside, with the resource still relative to the location
// directory, unless the project directory is the filesystem root.
describe("a location in a project subdirectory", () => {
  async function nested() {
    const f = await setup(), app = join(f.project, "app")
    return { ...f, app, location: { directory: app, projectDirectory: f.project } }
  }
  test("inside the location, the resource is location-relative", async () => {
    const f = await nested()
    expect(await fileAccess(f.location, "audio/in.wav")).toEqual({ absolute: join(f.app, "audio/in.wav"), resource: "audio/in.wav" })
  })
  test("inside the project but outside the location, the resource is location-relative and nothing external is asked", async () => {
    const f = await nested(), file = join(f.project, "docs/in.wav")
    expect(await fileAccess(f.location, "../docs/in.wav")).toEqual({ absolute: file, resource: "../docs/in.wav" })
    expect(await fileAccess(f.location, file)).toEqual({ absolute: file, resource: "../docs/in.wav" })
    expect(await fileAccess(f.location, f.project)).toEqual({ absolute: f.project, resource: ".." })
    expect(readRequests(await fileAccess(f.location, file))).toEqual([{ action: "read", resources: ["../docs/in.wav"], save: ["*"] }])
  })
  test("outside the project, the resource is absolute and external_directory is asked", async () => {
    const f = await nested(), file = join(f.repository, "audio/in.wav")
    expect(await fileAccess(f.location, file)).toEqual({ absolute: file, resource: file, external: { resource: `${join(f.repository, "audio")}/*`, save: `${f.repository}/*` } })
    expect((await fileAccess(f.location, `${f.project}-other/in.wav`)).external?.resource).toBe(`${f.project}-other/*`)
  })
  test("a project directory at the filesystem root does not make every file inside", async () => {
    const f = await setup(), file = join(f.repository, "audio/in.wav")
    expect(await fileAccess({ directory: f.project, projectDirectory: parse(f.project).root }, file)).toEqual({ absolute: file, resource: file, external: { resource: `${join(f.repository, "audio")}/*`, save: `${f.repository}/*` } })
  })
})

describe("requests per effect class", () => {
  test("read-file asks external_directory first when outside, then the host's read with save *", async () => {
    const f = await setup(), inside = await fileAccess(f.location, "in.wav"), outside = await fileAccess(f.location, join(f.repository, "audio/in.wav"))
    expect(readRequests(inside)).toEqual([{ action: "read", resources: ["in.wav"], save: ["*"] }])
    expect(readRequests(outside)).toEqual([
      { action: "external_directory", resources: [`${join(f.repository, "audio")}/*`], save: [`${f.repository}/*`] },
      { action: "read", resources: [join(f.repository, "audio/in.wav")], save: ["*"] },
    ])
  })
  test("write-file asks the tool's own action, then external_directory and edit for a given path", async () => {
    const f = await setup()
    const own = { action: "utilities_speech_synthesize", resources: ["kitten-nano-int8/Luna"], save: ["*"], metadata: { voice: "Luna", characters: 5 } }
    expect(synthesisRequests("Luna", 5)).toEqual([own])
    expect(synthesisRequests("Luna", 5, await fileAccess(f.location, "out/hello.wav"))).toEqual([own, { action: "edit", resources: ["out/hello.wav"], save: ["*"] }])
    expect(synthesisRequests("Luna", 5, await fileAccess(f.location, join(f.repository, "hello.wav")))).toEqual([
      own, { action: "external_directory", resources: [`${f.repository}/*`], save: [`${f.repository}/*`] }, { action: "edit", resources: [join(f.repository, "hello.wav")], save: ["*"] },
    ])
  })
})

describe("the runtime asks the host-format file requests", () => {
  async function runtime(subdirectory?: string) {
    const f = await setup(), authorize = vi.fn<Authorize>(async () => {})
    const directory = subdirectory === undefined ? f.project : join(f.project, subdirectory)
    await mkdir(directory, { recursive: true })
    const rt = await createRuntime(f.options({ authorize, location: { project: "project-a", directory, projectDirectory: f.project } })); cleanups.push(() => rt.close())
    return { ...f, authorize, rt, location: { directory, projectDirectory: f.project } }
  }
  test("transcription inside and outside the project", async () => {
    const f = await runtime()
    await mkdir(join(f.project, "audio")); await writeFile(join(f.project, "audio/in.wav"), wav()); await writeFile(join(f.repository, "audio/in.wav"), wav())
    await f.rt.invoke("speech_transcribe", { path: "audio/in.wav" }, invocation())
    await f.rt.invoke("speech_transcribe", { path: join(f.repository, "audio/in.wav") }, invocation())
    expect(f.authorize.mock.calls.map(c => c[0])).toEqual([readRequests(await fileAccess(f.location, "audio/in.wav")), readRequests(await fileAccess(f.location, join(f.repository, "audio/in.wav")))])
  })
  test("synthesis to a path inside and outside the project", async () => {
    const f = await runtime()
    await f.rt.invoke("speech_synthesize", { text: "hello", path: "out/hello.wav" }, invocation())
    await f.rt.invoke("speech_synthesize", { text: "hello", voice: "Bella", path: join(f.repository, "hello.wav") }, invocation())
    expect(f.authorize.mock.calls.map(c => c[0])).toEqual([
      synthesisRequests("Luna", 5, await fileAccess(f.location, "out/hello.wav")),
      synthesisRequests("Bella", 5, await fileAccess(f.location, join(f.repository, "hello.wav"))),
    ])
  })
  test("from a project subdirectory, other files in the project ask no external_directory", async () => {
    const f = await runtime("app")
    await mkdir(join(f.project, "audio")); await writeFile(join(f.project, "audio/in.wav"), wav())
    await f.rt.invoke("speech_transcribe", { path: "../audio/in.wav" }, invocation())
    await f.rt.invoke("speech_synthesize", { text: "hello", path: join(f.project, "out/hello.wav") }, invocation())
    expect(f.authorize.mock.calls.map(c => c[0])).toEqual([
      [{ action: "read", resources: ["../audio/in.wav"], save: ["*"] }],
      [synthesisRequests("Luna", 5)[0], { action: "edit", resources: ["../out/hello.wav"], save: ["*"] }],
    ])
  })
})
