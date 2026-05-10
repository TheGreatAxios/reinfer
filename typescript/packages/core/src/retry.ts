import type { CheckResult, ValidationResult } from './types'
import { formatViolations } from './validator'

/**
 * Build a retry feedback string from validation violations.
 */
export function buildRetryFeedback(
  validation: ValidationResult,
  options?: { includeRaw?: boolean },
): string {
  const parts: string[] = []

  if (validation.violations.length > 0) {
    parts.push('Your previous response had validation errors:\n')
    parts.push(formatViolations(validation.violations))
  }

  if (options?.includeRaw && typeof validation.rawValue === 'string') {
    parts.push(`\n\nYour response was:\n${validation.rawValue}`)
  }

  parts.push('\n\nPlease fix the issues and respond again.')

  return parts.join('')
}

/**
 * Build tool-call retry feedback.
 */
export function buildToolCallRetryFeedback(
  functionName: string,
  violations: CheckResult[],
  toolCallId?: string,
): { message: string; toolCallId?: string } {
  const message = `Your tool call to '${functionName}' had argument errors:\n${formatViolations(violations)}\n\nPlease call the function again with corrected arguments.`

  return { message, toolCallId }
}

/**
 * Generic retry message template for AI SDK-style interfaces.
 * Returns a prompt string that can be appended to the original prompt.
 */
export function buildRetryPrompt(
  originalPrompt: string,
  errorMessage: string,
): string {
  return `${originalPrompt}\n\nYour previous response failed validation:\n${errorMessage}\n\nPlease fix the issues and respond with valid output matching the schema.`
}
