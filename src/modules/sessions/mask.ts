/**
 * Masks secrets in text a stopgap returns. Session text is untrusted and often holds credentials someone pasted into a
 * terminal, a command line or a header, and `utilities_sessions_grep` echoes what it finds: every result passes through
 * here so the shapes below are redacted before the text reaches a model, a log or a person. The surrounding words stay,
 * so the result still says what was there.
 */
const RULES: readonly (readonly [RegExp, string])[] = [
  // An AWS access key id: AKIA and sixteen more uppercase letters or digits.
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA****************"],
  // OpenAI-style project and standard keys.
  [/\bsk-proj-[A-Za-z0-9_-]{8,}/g, "sk-proj-[redacted]"],
  [/\bsk-(?!proj-)[A-Za-z0-9_-]{8,}/g, "sk-[redacted]"],
  // Authorization: Bearer <token>, and a bare Bearer <token>.
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  // password=hunter2, passwd = …, pwd: …, and "password": "…".
  [/\b(password|passwd|pwd)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&"']+)/gi, "$1$2[redacted]"],
  // token=…, access_token=…, api_key=…, apiKey=…, secret=….
  [/\b(access_token|api[_-]?key|secret|token)(\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&"']+)/gi, "$1$2[redacted]"],
]

/** `text` with each recognized secret replaced by a marker that keeps the surrounding context. */
export function mask(text: string): string {
  let masked = text
  for (const [pattern, replacement] of RULES) masked = masked.replace(pattern, replacement)
  return masked
}
