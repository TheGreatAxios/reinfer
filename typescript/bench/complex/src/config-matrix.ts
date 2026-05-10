import { autoFixJson, extractString } from 'reinfer'

/**
 * Configuration matrix for A/B comparison of validation strategies.
 *
 * Each scenario is run against every config variant. Results are compared
 * to answer questions like:
 *   - Does auto-fix save API calls? (Yes: fewer retries needed)
 *   - Does failFast reduce latency? (Yes: stops on first violation)
 *   - Does stripProse help? (More passes on prose-wrapped responses)
 *   - What's the optimal maxAttempts? (Diminishing returns after 3)
 */

export interface ValidationConfig {
  name: string
  description: string
  maxAttempts: number
  autoFixEnabled: boolean
  failFast: boolean
  stripProse: boolean
}

export const CONFIG_MATRIX: ValidationConfig[] = [
  // ── Baseline: no extras ──
  {
    name: 'baseline',
    description: 'No auto-fix, no prose strip, 1 attempt',
    maxAttempts: 1,
    autoFixEnabled: false,
    failFast: false,
    stripProse: false,
  },
  // ── Auto-fix only ──
  {
    name: 'autofix-only',
    description: 'Auto-fix enabled, 1 attempt',
    maxAttempts: 1,
    autoFixEnabled: true,
    failFast: false,
    stripProse: false,
  },
  // ── Retry only ──
  {
    name: 'retry-only',
    description: '3 attempts, no auto-fix, no prose strip',
    maxAttempts: 3,
    autoFixEnabled: false,
    failFast: false,
    stripProse: false,
  },
  // ── Full stack ──
  {
    name: 'full-stack',
    description: 'Auto-fix + prose strip + 3 retries',
    maxAttempts: 3,
    autoFixEnabled: true,
    failFast: false,
    stripProse: true,
  },
  // ── Fast fail ──
  {
    name: 'fast-fail',
    description: 'Auto-fix + prose + fail-fast + 3 retries',
    maxAttempts: 3,
    autoFixEnabled: true,
    failFast: true,
    stripProse: true,
  },
  // ── Max attempts ──
  {
    name: 'max-retries',
    description: 'Auto-fix + prose + 5 attempts',
    maxAttempts: 5,
    autoFixEnabled: true,
    failFast: false,
    stripProse: true,
  },
]

/**
 * Apply a validation config to a raw model response.
 * No API calls — replays the same text through different validation strategies.
 */
export function applyConfig(
  rawResponse: string,
  config: ValidationConfig,
  schema: import('zod').ZodSchema,
): { passed: boolean; violations: string[]; retriesNeeded: number; autoFixApplied: string[]; error?: string } {
  let currentText = rawResponse
  let retriesNeeded = 0
  let autoFixApplied: string[] = []

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    let valueToValidate: string
    if (config.autoFixEnabled) {
      const { fixed, fixes } = autoFixJson(currentText)
      valueToValidate = fixed ?? currentText
      if (fixes.length > 0) {
        autoFixApplied = [...autoFixApplied, ...fixes]
      }
    } else {
      valueToValidate = currentText
    }

    if (config.stripProse) {
      const extracted = extractString(valueToValidate, true)
      if (extracted) valueToValidate = extracted
    }

    try {
      const parsed = JSON.parse(valueToValidate)
      const schemaResult = (schema as any).safeParse(parsed)
      if (schemaResult.success) {
        return { passed: true, violations: [], retriesNeeded, autoFixApplied }
      }
      const violations = schemaResult.error.issues.map(
        (i: any) => `${i.path.join('.')}: ${i.message}`,
      )

      if (config.failFast) {
        return { passed: false, violations: violations.slice(0, 3), retriesNeeded, autoFixApplied }
      }

      retriesNeeded = attempt
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON'
      retriesNeeded = attempt

      if (config.failFast) {
        return { passed: false, violations: [msg], retriesNeeded, autoFixApplied }
      }
    }
  }

  return { passed: false, violations: ['Max attempts exceeded'], retriesNeeded, autoFixApplied }
}
