import { type Check, type CheckResult, type Schema, type ValidationResult } from './types'

/**
 * Core validator engine.
 * Runs a value through a Schema's checks, collecting results and violations.
 */
export async function validate(
  value: unknown,
  schema: Schema,
  attempt = 1,
): Promise<ValidationResult> {
  const results: CheckResult[] = []

  for (const check of schema.checks) {
    const result = await check.run(value)
    results.push(result)

    if (!result.passed && schema.failFast) {
      break
    }
  }

  const violations = results.filter(r => !r.passed)

  return {
    passed: violations.length === 0,
    schemaName: schema.name,
    rawValue: value,
    results,
    violations,
    attempt,
  }
}

/**
 * Extract a string from a raw response, stripping prose wrapping if needed.
 * Returns the extracted string or null if no extractable content found.
 */
export function extractString(raw: unknown, stripProse = true): string | null {
  if (typeof raw !== 'string') return null
  if (!stripProse) return raw

  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  // Try to find JSON content inside prose
  const firstBrace = trimmed.indexOf('{')
  const firstBracket = trimmed.indexOf('[')

  if (firstBrace === -1 && firstBracket === -1) return trimmed

  const start = (() => {
    if (firstBrace >= 0 && firstBracket >= 0) return Math.min(firstBrace, firstBracket)
    if (firstBrace >= 0) return firstBrace
    return firstBracket
  })()

  const lastBrace = trimmed.lastIndexOf('}')
  const lastBracket = trimmed.lastIndexOf(']')
  const end = Math.max(lastBrace, lastBracket)

  if (end >= 0 && end < trimmed.length - 1) {
    return trimmed.substring(start, end + 1).trim()
  }

  if (start > 0) {
    return trimmed.substring(start).trim()
  }

  return trimmed
}

/**
 * Collect violation messages into a human-readable string.
 */
export function formatViolations(violations: CheckResult[]): string {
  return violations
    .map(v => `• [${v.checkName}] ${v.message ?? 'validation failed'}`)
    .join('\n')
}
