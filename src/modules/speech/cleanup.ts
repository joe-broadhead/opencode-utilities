import type * as z from "zod"
import type { speechInputs, speechOutputs } from "./contracts.js"

// Rule-based text cleanup, ported from aurum-core's `RulesCleanup` (aurum 8e3b70f, crates/aurum-core/src/cleanup/rules.rs)
// with the English rules the speech engine applied. No model and no engine: pure string rules, so the same input
// gives the same output as the engine did. Rust's regex `\b`, `\s`, `trim` and `is_alphabetic` are Unicode-aware;
// the patterns below spell those classes out so JavaScript matches the same characters.

type Style = z.output<typeof speechInputs.cleanup>["style"]
type Output = z.output<typeof speechOutputs.cleanup>

const WORD = String.raw`\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}`
const SPACE = String.raw`\p{White_Space}`
const word = (phrase: string) => new RegExp(`(?<![${WORD}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![${WORD}])`, "giu")

const WS2 = /[ \t]{2,}/gu
const SPACE_PUNCT = /[ \t]+([,.!?;:])/gu
const SENTENCE_SPLIT = new RegExp(`[.!?]+[${SPACE}]+`, "u")
const EDGES = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, "gu")
const ALPHABETIC = /\p{Alphabetic}/u

/** Fillers removed with one trailing comma or full stop, multi-word ones first. */
const FILLERS = [
  ...["you know", "i mean", "sort of", "kind of", "okay so", "so yeah"],
  ...["um", "uh", "uhm", "erm", "ah", "eh"],
].map(filler => new RegExp(`${word(filler).source}[,.]?`, "giu"))

/** Safe professional expansions only: I'd, it's, that's and there's are ambiguous and stay. */
const PROFESSIONAL: readonly (readonly [RegExp, string])[] = ([
  ["can't", "cannot"], ["won't", "will not"], ["don't", "do not"], ["didn't", "did not"], ["isn't", "is not"],
  ["aren't", "are not"], ["wasn't", "was not"], ["weren't", "were not"], ["haven't", "have not"], ["hasn't", "has not"],
  ["hadn't", "had not"], ["I'm", "I am"], ["I've", "I have"], ["I'll", "I will"], ["we're", "we are"], ["we've", "we have"],
  ["we'll", "we will"], ["they're", "they are"], ["they've", "they have"], ["gonna", "going to"], ["wanna", "want to"],
  ["kinda", "kind of"], ["yeah", "yes"], ["yep", "yes"], ["nope", "no"], ["asap", "as soon as possible"], ["fyi", "for your information"],
] as const).map(([from, to]) => [word(from), to] as const)

const trim = (text: string) => text.replace(EDGES, "")
const characters = (text: string) => [...text].length
/** Rust's `str::lines` then `trim`, dropping empty lines, joined with one space. */
const joinLines = (text: string) => text.split("\n").map(trim).filter(Boolean).join(" ")

/** Tidies dictated or transcribed text. The output matches the speech engine's `rules` provider. */
export function cleanup(text: string, style: Style): Output {
  return { text: trim(text) === "" ? "" : apply(text, style), style, provider: "rules" }
}

function apply(text: string, style: Style) {
  switch (style) {
    case "raw": return trim(text)
    case "clean": return clean(text)
    case "bullets": return bullets(clean(text))
    case "professional": return professional(clean(text))
    case "summary": return summarize(clean(text))
  }
}

/** Paragraph by paragraph: join lines, drop fillers, tidy spacing, capitalise sentences, end with a full stop. */
function clean(text: string) {
  return text.split("\n\n").map(paragraph => {
    let result = joinLines(paragraph).replace(WS2, " ")
    for (const filler of FILLERS) result = result.replace(filler, "")
    result = capitalizeSentences(trim(result.replace(WS2, " ").replace(SPACE_PUNCT, "$1")))
    if (characters(result) > 12 && !".!?".includes(result.at(-1)!)) result += "."
    return result
  }).filter(paragraph => paragraph !== "").join("\n\n")
}

function professional(text: string) {
  return text.split("\n\n").map(paragraph => {
    let result = paragraph
    for (const [pattern, replacement] of PROFESSIONAL) result = result.replace(pattern, replacement)
    return capitalizeSentences(trim(result.replace(WS2, " ")))
  }).filter(paragraph => paragraph !== "").join("\n\n")
}

function bullets(text: string) {
  let parts = sentences(text)
  if (parts.length === 1) {
    const commas = text.split(",").map(trim).filter(Boolean)
    if (commas.length >= 3) parts = commas
  }
  if (parts.length <= 1) return `• ${text}`
  return parts.map(part => part.replace(/^[.!?;: ]+|[.!?;: ]+$/gu, "")).filter(Boolean).map(part => `• ${capitalizeFirst(part)}`).join("\n")
}

/** The first sentence plus the longest later one; the last of equally long ones wins, as in Rust's `max_by_key`. */
function summarize(text: string) {
  const parts = sentences(text)
  if (parts.length <= 2) return text
  const first = parts[0]!
  const longest = parts.slice(1).reduce((best, part) => characters(part) >= characters(best) ? part : best)
  return longest === "" || longest === first ? first : `${first} ${longest}`
}

function sentences(text: string) {
  const parts = text.split(SENTENCE_SPLIT).map(trim).filter(Boolean)
  return parts.length ? parts : [text]
}

function capitalizeSentences(text: string) {
  let result = "", next = true
  for (const character of text) {
    if (next && ALPHABETIC.test(character)) { result += character.toUpperCase(); next = false }
    else { result += character; if (".!?".includes(character)) next = true }
  }
  return result
}

const capitalizeFirst = (text: string) => {
  const [first, ...rest] = text
  return first === undefined ? "" : first.toUpperCase() + rest.join("")
}
