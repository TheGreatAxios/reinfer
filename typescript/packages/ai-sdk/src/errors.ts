/**
 * Error classification for AI SDK calls.
 *
 * Determines whether an error should trigger a retry,
 * an escape hatch, or be re-thrown.
 */

export type ErrorAction = 'retry' | 'escape' | 'throw'

/**
 * Classify an AI SDK error.
 */
export function classifyError(error: unknown): ErrorAction {
  if (!error || typeof error !== 'object') return 'throw'

  const e = error as Record<string, unknown>
  const name = String(e.name ?? '')
  const status = typeof e.status === 'number' ? e.status : 0
  const message = String(e.message ?? '').toLowerCase()

  // ── Validation errors (catchable — retry with feedback) ──
  // TypeValidationError, ZodError, NoObjectGeneratedError from generateObject
  if (
    name.includes('typevalidation') ||
    name.includes('zod') ||
    name.includes('output_validation') ||
    name.includes('validation') ||
    name.includes('noobjectgenerated') ||
    name.includes('jsonparseerror')
  ) {
    return 'retry'
  }

  // ── Transient API errors (retry with backoff) ──
  if (
    status === 429 ||                        // rate limit
    status === 529 ||                        // overloaded (Anthropic)
    status === 503 ||                        // service unavailable
    message.includes('rate limit') ||
    message.includes('timeout') ||
    message.includes('overloaded') ||
    message.includes('too many requests')
  ) {
    return 'retry'
  }

  // ── Permanent API errors (escape or throw) ──
  if (
    status === 400 ||                        // bad request (prompt is broken)
    status === 401 ||                        // auth error
    status === 403 ||                        // permission denied
    status === 404 ||                        // not found
    message.includes('authentication') ||
    message.includes('permission') ||
    message.includes('not found') ||
    message.includes('no such model')
  ) {
    return 'escape'
  }

  // ── Content filter / safety (escape) ──
  if (
    message.includes('content filter') ||
    message.includes('safety') ||
    message.includes('refusal')
  ) {
    return 'escape'
  }

  // Default: treat as transient retryable
  return 'retry'
}

/**
 * Check if error is an AI SDK validation/parse throw (generateObject failure).
 *
 * This includes:
 * - TypeValidationError: Zod schema validation failed
 * - NoObjectGeneratedError: could not parse the model output as JSON
 * - JSONParseError: internal JSON parse failure
 */
export function isValidationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as Record<string, unknown>
  const name = String(e.name ?? '')
  return (
    name.includes('TypeValidationError') ||
    name.includes('NoObjectGeneratedError') ||
    name.includes('JSONParseError') ||
    name.includes('ZodError') ||
    name.includes('OutputValidationError')
  )
}
