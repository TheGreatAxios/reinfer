import {
  type Schema,
  type ValidationResult,
  type ValidatorOptions,
  type ValidationFailureEvent,
  validate,
  autoFixJson,
  buildRetryFeedback,
  buildRetryPrompt,
  extractString,
} from 'reinfer'

import { hasSchema, detectSchema, getFinishReason } from './signals'
import { extractText, extractRawFromError } from './extractor'
import { classifyError, isValidationError } from './errors'

// Re-export just the AI SDK functions we wrap
import { generateText as aiGenerateText, generateObject as aiGenerateObject } from 'ai'

export type { ValidatorOptions, Schema, ValidationResult }

/**
 * Resolved configuration for a validated() call.
 */
interface ResolvedConfig {
  maxAttempts: number
  escape: 'return_raw' | 'default' | 'fallback_model'
  autoDetect: boolean
  stripProse: boolean
  failFast: boolean
}

function resolveConfig(options?: ValidatorOptions): ResolvedConfig {
  return {
    maxAttempts: options?.maxAttempts ?? 3,
    escape: options?.escape ?? 'return_raw',
    autoDetect: options?.autoDetect ?? true,
    stripProse: options?.stripProse ?? true,
    failFast: options?.failFast ?? false,
  }
}

/**
 * Wrapper around Vercel AI SDK's generateText() with automatic validation and retry.
 *
 * When a schema is detected (via params.schema or params.output.schema),
 * the proxy validates the output and retries with feedback on failure.
 * When no schema is detected, the function passes through with zero overhead.
 */
async function wrappedGenerateText(
  params: Parameters<typeof aiGenerateText>[0],
  config: ResolvedConfig,
  schemas?: Record<string, Schema>,
  onValidationFailure?: (event: ValidationFailureEvent) => void | Promise<void>,
): Promise<Awaited<ReturnType<typeof aiGenerateText>>> {
  // ── No schema → pure passthrough ──
  // But if user provided custom schemas in validated() config, we still validate
  const hasExplicitSchema = hasSchema(params as Record<string, unknown>)
  const hasCustomSchemas = schemas && Object.keys(schemas).length > 0

  if (!config.autoDetect || (!hasExplicitSchema && !hasCustomSchemas)) {
    return aiGenerateText(params)
  }

  const schema = schemas?.['default'] ?? null

  let lastError: Error | null = null
  let attempt = 1

  while (attempt <= config.maxAttempts) {
    try {
      const result = await aiGenerateText(params)
      const finishReason = getFinishReason(result)

      // Truncation → retry with hint
      if (finishReason === 'length') {
        if (attempt < config.maxAttempts) {
          const truncatedPrompt = `${params.prompt}\n\nYour previous response was truncated (max tokens reached). Please provide a complete response.`
          params = { ...params, prompt: truncatedPrompt }
          attempt++
          continue
        }
        return result
      }

      // Extraction + validation
      const text = extractText(result)
      if (text && schema) {
        const valueToValidate = config.stripProse
          ? (autoFixJson(text).fixed ?? text)
          : text

        const validation = await validate(valueToValidate, schema, attempt)

        if (validation.passed) {
          return result
        }

        // Build retry context
        const feedback = buildRetryFeedback(validation)
        params = {
          ...params,
          prompt: buildRetryPrompt(String(params.prompt ?? ''), feedback),
        }

        if (onValidationFailure) {
          await onValidationFailure({
            violations: validation.violations.map(v => v.message ?? v.checkName),
            rawResponse: text,
            schema: schema.name,
            attempt,
            toolCalls: null,
            retry: async () => {
              // Allow callback to trigger retry manually
              const retryResult = await aiGenerateText(params)
              return retryResult
            },
          })
        }
      }

      attempt++
    } catch (err) {
      // Classify and handle error
      const action = classifyError(err)
      const rawValue = extractRawFromError(err)

      if (isValidationError(err) && rawValue) {
        // Auto-fix attempt: try to fix the raw text and re-validate
        if (schema) {
          const { fixed } = autoFixJson(rawValue)
          if (fixed) {
            const validation = await validate(fixed, schema, attempt)
            if (validation.passed) {
              // Auto-fix succeeded — reconstruct result
              const parsed = JSON.parse(fixed)
              return {
                text: fixed,
                // Preserve any other fields from the error context
              } as Awaited<ReturnType<typeof aiGenerateText>>
            }
          }
        }

        // Failed validation — retry with feedback
        if (attempt < config.maxAttempts) {
          params = {
            ...params,
            prompt: buildRetryPrompt(
              String(params.prompt ?? ''),
              err instanceof Error ? err.message : String(err),
            ),
          }
          attempt++
          continue
        }
      } else if (action === 'retry') {
        // Transient error (rate limit, timeout) — backoff and retry
        if (attempt < config.maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
          await new Promise(resolve => setTimeout(resolve, delay))
          attempt++
          continue
        }
      } else if (action === 'escape') {
        // Permanent error — throw immediately
        throw err
      }

      lastError = err instanceof Error ? err : new Error(String(err))
      attempt++
    }
  }

  // Exhausted retries
  if (lastError) throw lastError
  throw new Error(`Failed after ${config.maxAttempts} attempts`)
}

/**
 * Wrapper around Vercel AI SDK's generateObject() with automatic validation and retry.
 *
 * The AI SDK already validates against Zod schema internally and throws on failure.
 * This proxy catches the throw, extracts the raw text, attempts auto-fix,
 * and retries with diagnostic feedback.
 */
async function wrappedGenerateObject(
  params: Parameters<typeof aiGenerateObject>[0],
  config: ResolvedConfig,
  schemas?: Record<string, Schema>,
  onValidationFailure?: (event: ValidationFailureEvent) => void | Promise<void>,
): Promise<Awaited<ReturnType<typeof aiGenerateObject>>> {
  // ── No schema → pure passthrough ──
  if (!config.autoDetect || !hasSchema(params as Record<string, unknown>)) {
    return aiGenerateObject(params)
  }

  let lastError: Error | null = null
  let attempt = 1

  while (attempt <= config.maxAttempts) {
    try {
      // Try the call — SDK validates internally and throws on failure
      const result = await aiGenerateObject(params)
      return result
    } catch (err) {
      const action = classifyError(err)
      const rawValue = extractRawFromError(err)

      // ── Validation error (Zod/TypeValidation) — auto-fix + retry ──
      if (isValidationError(err) && rawValue) {
        // Attempt 1: auto-fix the raw text and try to parse against schema
        const { fixed } = autoFixJson(rawValue)
        if (fixed) {
          try {
            const parsed = JSON.parse(fixed)
            // Try to run the schema parse manually (schema is a Zod schema in params)
            const userSchema = (params as Record<string, unknown>).schema
            if (userSchema && typeof userSchema === 'object') {
              const zodSchema = userSchema as { safeParse?: (data: unknown) => { success: boolean; data?: unknown; error?: unknown } }
              if (typeof zodSchema.safeParse === 'function') {
                const parsedResult = zodSchema.safeParse(parsed)
                if (parsedResult.success) {
                  // Auto-fix + re-parse succeeded — return fixed result
                  return {
                    object: parsedResult.data,
                    // Other result fields from the error context
                  } as Awaited<ReturnType<typeof aiGenerateObject>>
                }
              }
            }
          } catch {
            // JSON parse failed even after auto-fix — fall through to retry
          }
        }

        // Attempt 2: retry with diagnostic feedback
        if (attempt < config.maxAttempts) {
          const feedback = err instanceof Error ? err.message : String(err)
          // For generateObject, we can inject the error into a system-style retry
          params = {
            ...params,
            prompt: buildRetryPrompt(
              String(
                (params as Record<string, unknown>).prompt ??
                  (params as Record<string, unknown>).system ??
                  '',
              ),
              feedback,
            ),
          } as Parameters<typeof aiGenerateObject>[0]

          if (onValidationFailure) {
            await onValidationFailure({
              violations: [feedback],
              rawResponse: rawValue,
              schema: 'ai-sdk-object',
              attempt,
              toolCalls: null,
              retry: async () => {
                const retryResult = await aiGenerateObject(params)
                return retryResult
              },
            })
          }

          attempt++
          continue
        }
      } else if (action === 'retry') {
        // Transient error — backoff and retry
        if (attempt < config.maxAttempts) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
          await new Promise(resolve => setTimeout(resolve, delay))
          attempt++
          continue
        }
      } else if (action === 'escape') {
        // Permanent error — throw
        throw err
      }

      lastError = err instanceof Error ? err : new Error(String(err))
      attempt++
    }
  }

  if (lastError) throw lastError
  throw new Error(`Failed after ${config.maxAttempts} attempts`)
}

/**
 * Create validated wrappers for Vercel AI SDK functions.
 *
 * Usage:
 * ```ts
 * import { validated } from 'reinfer-ai-sdk'
 * import { openai } from '@ai-sdk/openai'
 *
 * const { generateText, generateObject } = validated({ maxAttempts: 3 })
 *
 * // Same API as 'ai' SDK, with automatic validation + retry
 * const result = await generateText({
 *   model: openai('gpt-4o'),
 *   prompt: 'Generate JSON: { "name": string, "age": number }',
 * })
 * ```
 */
export function validated(options?: ValidatorOptions) {
  const config = resolveConfig(options)
  const schemas = options?.schemas

  return {
    generateText: (params: Parameters<typeof aiGenerateText>[0]) =>
      wrappedGenerateText(params, config, schemas, options?.onValidationFailure),

    generateObject: (params: Parameters<typeof aiGenerateObject>[0]) =>
      wrappedGenerateObject(params, config, schemas, options?.onValidationFailure),
  }
}
