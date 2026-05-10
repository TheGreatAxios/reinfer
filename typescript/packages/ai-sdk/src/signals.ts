import type { Schema } from 'reinfer'

/**
 * Detect if the params include a schema/structured output definition.
 *
 * Supports multiple AI SDK patterns:
 * - generateObject({ schema })
 * - generateText({ output: Output.object({ schema }) })
 * - generateText({ output: Output.text({ schema }) })
 * - custom responseFormat
 */
export function hasSchema(params: Record<string, unknown>): boolean {
  return !!(
    params.schema ||
    (params.output as Record<string, unknown> | undefined)?.schema ||
    params.responseFormat
  )
}

/**
 * Detect the schema from AI SDK params.
 * Returns the zod/JSON schema object or undefined.
 */
export function detectSchema(
  params: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (params.schema) return params.schema as Record<string, unknown>
  if (params.output) {
    const output = params.output as Record<string, unknown>
    if (output.schema) return output.schema as Record<string, unknown>
  }
  return undefined
}

/**
 * Map AI SDK finishReason to our canonical values.
 */
export type CanonicalFinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'error'
  | 'tool_calls'
  | 'other'

export function mapFinishReason(finishReason?: string): CanonicalFinishReason {
  switch (finishReason) {
    case 'stop':
    case 'done':
      return 'stop'
    case 'length':
    case 'max_tokens':
      return 'length'
    case 'content-filter':
    case 'content_filter':
    case 'safety':
      return 'content_filter'
    case 'tool-calls':
    case 'tool_calls':
      return 'tool_calls'
    case 'error':
      return 'error'
    default:
      return 'other'
  }
}

/**
 * Read finishReason from various AI SDK result shapes.
 */
export function getFinishReason(result: unknown): CanonicalFinishReason {
  // generateText result: result.finishReason
  if (
    result &&
    typeof result === 'object' &&
    'finishReason' in result &&
    typeof (result as Record<string, unknown>).finishReason === 'string'
  ) {
    return mapFinishReason((result as Record<string, unknown>).finishReason as string)
  }
  return 'other'
}
