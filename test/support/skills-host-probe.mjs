// One real embedded OpenCode 2.4.1 host in a fresh process, so no skill registered by another host can leak in.
// The parent test sets an isolated HOME/XDG and passes the plugin entry and the location directory.
// Usage: node test/support/skills-host-probe.mjs <entry> <directory>
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const [entry, directory] = process.argv.slice(2)
if (!entry || !directory) throw new Error("usage: node test/support/skills-host-probe.mjs <entry> <directory>")

const { OpenCode } = await import("@opencode/sdk")
const plugin = (await import(pathToFileURL(entry).href)).default
const host = await OpenCode.create({
  app: { name: "opencode", version: "2.4.1" },
  plugins: [plugin],
  database: { path: join(directory, "opencode-probe.db") },
  models: { fetch: false },
  fs: { filewatcher: false },
  config: { directory },
  log: { level: "error", emit: () => undefined },
})
try {
  const session = await host.sessions.create({ location: { directory }, agent: "build" })
  await host.sessions.prompt({ sessionID: session.id, text: "activate the utilities plugin", delivery: "queue" }).catch(() => undefined)
  const until = Date.now() + 20_000
  for (;;) {
    const active = await host.plugin.list({ location: { directory } }).then((list) => list.data.some(item => item.id === "utilities"), () => false)
    if (active || Date.now() > until) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const skills = await host.skill.list({ location: { directory } })
  const commands = await host.command.list({ location: { directory } })
  const integrations = await host.integration.list({ location: { directory } })
  const answer = await host.rpc.call({ rpcID: "utilities", method: "status", input: { sessionID: session.id, input: {} }, location: { directory } })
  process.stdout.write(JSON.stringify({ skills: skills.data, commands: commands.data, integrations: integrations.data, status: answer.output }))
} finally {
  await host.close().catch(() => undefined)
}
process.exit(0)
