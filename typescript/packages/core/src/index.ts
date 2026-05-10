// ── Core exports ──

export { Schema } from './types'
export { validate, extractString, formatViolations } from './validator'
export type {
  Check,
  CheckResult,
  SchemaConfig,
  ValidationResult,
  ValidatorOptions,
  ValidationFailureEvent,
  EscapeEvent,
  LoggerFn,
  AutoFixResult,
} from './types'

export { autoFixJson } from './auto-fix'
export { buildRetryFeedback, buildToolCallRetryFeedback, buildRetryPrompt } from './retry'

export { registry } from './schemas/registry'
export { validJson, isObject, requiredFields, fieldTypes, enumValues } from './schemas/json-schema'
