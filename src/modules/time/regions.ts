/**
 * Regional holidays. time-keep's offline data (the holidays crate) lists a country's regional holidays with its
 * nationwide ones and marks them only in the name: `Summer Bank Holiday [Scotland]`. Only GB, and IM, which copies
 * GB's rows, use the bracket for regions; elsewhere a bracket holds an English name, as in `Año nuevo [New Year's
 * Day]`, so only these countries are parsed, and only against the known region names. One row per date joins
 * several holidays with ", ", so a row is nationwide when any of its parts has no region.
 */
export const GB_REGIONS = ["England", "Wales", "Scotland", "Northern Ireland"] as const
export type Region = typeof GB_REGIONS[number]
/** Countries whose rows carry region tags. Only GB takes the `region` parameter. */
const TAGGED: ReadonlySet<string> = new Set(["GB", "IM"])

interface NativeHoliday { readonly country_code: string; readonly country: string; readonly date: string; readonly name: string }
export interface Holiday extends NativeHoliday { readonly nationwide: boolean; readonly regions: Region[] }

export function mark(holiday: NativeHoliday): Holiday {
  if (!TAGGED.has(holiday.country_code)) return { ...holiday, nationwide: true, regions: [] }
  const regions = new Set<Region>()
  for (const part of holiday.name.split(", ")) {
    const names = /\[([^\]]+)\]/.exec(part)?.[1]?.split("/").map(name => name.trim())
    if (!names || !names.every((name): name is Region => (GB_REGIONS as readonly string[]).includes(name))) return { ...holiday, nationwide: true, regions: [] }
    for (const name of names) regions.add(name)
  }
  return { ...holiday, nationwide: false, regions: GB_REGIONS.filter(name => regions.has(name)) }
}
/** Whether a holiday counts: nationwide ones always, regional ones only for their own region. */
export const applies = (holiday: Holiday, region: Region | undefined) => holiday.nationwide || region !== undefined && holiday.regions.includes(region)
/** Whether a country's results can differ from time-keep's own once regional holidays are left out. */
export const tagged = (country: string) => TAGGED.has(country)
