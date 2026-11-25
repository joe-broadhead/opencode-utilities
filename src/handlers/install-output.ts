import * as z from "zod"

/** What native_install and speech_install answer: the files they fetched, their bytes, and the cache they landed in. */
export const InstallOutputSchema = z.strictObject({
  downloaded: z.array(z.strictObject({ name: z.string().max(128), bytes: z.number().int().nonnegative() })).max(16),
  bytes: z.number().int().nonnegative(),
  cacheDirectory: z.string().max(4096),
})
