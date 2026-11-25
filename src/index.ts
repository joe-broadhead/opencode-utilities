import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { loadConfig } from "./domain/config.js"
import { createHandlers } from "./handlers/index.js"
import { manifest, version } from "./manifest.js"
import { createProvider } from "./provider/index.js"
import { readSkills, registerSkills } from "./skills.js"

// One level below the package root both as source (src/) and as the bundle (dist/).
const packageRoot = fileURLToPath(new URL("../", import.meta.url))

/**
 * `assertHost`, the skills, one `register` call, and the host wiring the contract does not own: the provider's
 * integration and the package's skills, which OpenCode 2.4.1 loads only through `ctx.skill.transform`.
 */
export default Plugin.define({
  id: manifest.plugin.name,
  async setup(ctx) {
    assertHost(ctx, manifest)
    const config = loadConfig(ctx.options)
    // Check every skill before anything registers, so a malformed file fails setup with one clear error.
    const skills = readSkills()
    const provider = await createProvider({ context: ctx, config, packageRoot })
    let dispose = async (): Promise<void> => {}
    try {
      const registration = await register(ctx, manifest, createHandlers({
        provider,
        manifest,
        version,
        hostVersion: ctx.app.version,
        access: config.access,
      }))
      dispose = () => registration.dispose()
      // A host surface, not a method: 2.4.1 does not scan a plugin package's skills/ folder for them.
      const skillRegistration = await registerSkills(ctx, skills)
      return async () => {
        await skillRegistration.dispose()
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
