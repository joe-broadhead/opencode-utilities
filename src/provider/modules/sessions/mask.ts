/**
 * Masks secrets in text a stopgap returns. Session text is untrusted and often holds credentials someone pasted into a
 * terminal, a command line or a header, and `utilities_sessions_grep` echoes what it finds: every result passes through
 * here so the shapes below are redacted before the text reaches a model, a log or a person. The surrounding words stay,
 * so the result still says what was there.
 */
type Replacement = string | ((match: string, ...groups: string[]) => string)

/** Keeps the key and separator, and redacts the value, keeping its quotes so a JSON snippet stays readable. */
const assignment = (_match: string, key: string, separator: string, value: string): string =>
  `${key}${separator}${value.startsWith("\"") ? "\"[redacted]\"" : value.startsWith("'") ? "'[redacted]'" : "[redacted]"}`

// A closing quote may sit between the key and the separator, as in a quoted JSON key; the value may be quoted too.
const KEYS = String.raw`("?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&"']+)`
const RULES: readonly (readonly [RegExp, Replacement])[] = [
  // A GitHub token: ghp_, gho_, ghu_, ghs_ or ghr_ and at least 36 alphanumerics, and a fine-grained github_pat_ token.
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "github_pat_[redacted]"],
  [/\b(gh[pousr]_)[A-Za-z0-9]{36,}/g, "$1[redacted]"],
  // An AWS access key id: AKIA and sixteen more uppercase letters or digits.
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA****************"],
  // OpenAI-style project and standard keys.
  [/\bsk-proj-[A-Za-z0-9_-]{8,}/g, "sk-proj-[redacted]"],
  [/\bsk-(?!proj-)[A-Za-z0-9_-]{8,}/g, "sk-[redacted]"],
  // Authorization: Bearer <token>, and a bare Bearer <token>.
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  // A password, passwd or pwd key, a separator, and a value, quoted or bare.
  [new RegExp(String.raw`\b(password|passwd|pwd)${KEYS}`, "gi"), assignment],
  // token=…, access_token=…, api_key=…, apiKey=…, secret=….
  [new RegExp(String.raw`\b(access_token|api[_-]?key|secret|token)${KEYS}`, "gi"), assignment],
]

/** `text` with each recognized secret replaced by a marker that keeps the surrounding context. */
export function mask(text: string): string {
  let masked = text
  for (const [pattern, replacement] of RULES) {
    masked = typeof replacement === "string" ? masked.replace(pattern, replacement) : masked.replace(pattern, replacement)
  }
  return masked
}
