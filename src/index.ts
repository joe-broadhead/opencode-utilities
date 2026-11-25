import { fileURLToPath } from "node:url"
import { Plugin } from "@opencode/plugin"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { loadConfig } from "./domain/config.js"
import { createHandlers } from "./handlers/index.js"
import { manifest, version } from "./manifest.js"
import { createProvider } from "./provider/index.js"

// One level below the package root both as source (src/) and as the bundle (dist/).
const packageRoot = fileURLToPath(new URL("../", import.meta.url))

export default Plugin.define({
  id: manifest.plugin.name,
  async setup(ctx) {
    assertHost(ctx, manifest)
    const config = loadConfig(ctx.options)
    const provider = await createProvider({ context: ctx, config, packageRoot })
    try {
      const registration = await register(ctx, manifest, createHandlers({
        provider,
        manifest,
        version,
        hostVersion: ctx.app.version,
        access: config.access,
      }))
      return async () => {
        await registration.dispose()
        await provider.close()
      }
    } catch (error) {
      await provider.close().catch(() => undefined)
      throw error
    }
  },
})
