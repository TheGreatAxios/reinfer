import type { ValidationResult } from 'reinfer'

/**
 * Extract text from a generateText() or generateObject() result.
 *
 * generateText() → result.text (string)
 * generateObject() → result.object (parsed object, stringify for validation)
 */
export function extractText(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null

  const r = result as Record<string, unknown>

  // generateText result
  if (typeof r.text === 'string') {
    return r.text
  }

  // generateObject result — serialize object back to JSON string for validation
  if (r.object !== undefined && r.object !== null) {
    try {
      return JSON.stringify(r.object)
    } catch {
      return null
    }
  }

  return null
}

/**
 * Extract the raw text from a TypeValidationError or similar SDK error.
 *
 * The AI SDK throws errors that contain the raw model output.
 * We extract it here to feed into auto-fix + retry.
 */
export function extractRawFromError(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null

  const e = error as Record<string, unknown>

  // TypeValidationError: error.value contains the raw text
  if (typeof e.value === 'string') {
    return e.value
  }

  // Some errors have response.text or response.body
  if (e.response && typeof e.response === 'object') {
    const resp = e.response as Record<string, unknown>
    if (typeof resp.text === 'string') return resp.text
    if (typeof resp.body === 'string') return resp.body
  }

  // NoObjectGeneratedError: error.text contains the raw output
  if (typeof e.text === 'string') {
    return e.text
  }

  // Generic message fallback
  if (typeof e.message === 'string') {
    return e.message
  }

  return null
}
