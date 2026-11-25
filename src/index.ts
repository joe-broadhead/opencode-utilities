import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { loadConfig } from "./domain/config.js"
import { createHandlers } from "./handlers/index.js"
import { manifest, version } from "./manifest.js"
import { createProvider } from "./provider/index.js"
import { loadSkills, registerSkills } from "./skills.js"

// One level below the package root both as source (src/) and as the bundle (dist/).
const packageRoot = fileURLToPath(new URL("../", import.meta.url))

/**
 * `assertHost`, one `register` call, and the host wiring the contract does not own: the provider's integration, and
 * the package's skills, which OpenCode 2.4.1 loads only through `ctx.skill.transform`.
 */
export default Plugin.define({
  id: manifest.plugin.name,
  async setup(ctx) {
    assertHost(ctx, manifest)
    const config = loadConfig(ctx.options)
    const provider = await createProvider({ context: ctx, config, packageRoot })
    let dispose = async (): Promise<void> => {}
    try {
      const { skills, problems } = await loadSkills(join(packageRoot, "skills"))
      const registration = await register(ctx, manifest, createHandlers({
        provider,
        manifest,
        version,
        hostVersion: ctx.app.version,
        access: config.access,
        skillProblems: problems,
      }))
      dispose = () => registration.dispose()
      // A host surface, not a method: 2.4.1 does not scan a plugin package's skills/ folder for them.
      await registerSkills(ctx.skill, skills)
      return async () => {
        await dispose()
        await provider.close()
      }
    } catch (error) {
      await dispose().catch(() => undefined)
      await provider.close().catch(() => undefined)
      throw error
    }
  },
})
