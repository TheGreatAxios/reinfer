// ── Core types for reinfer ──

/** The result of a single check evaluation. */
export interface CheckResult {
  readonly checkName: string
  readonly passed: boolean
  readonly message?: string // human-readable failure description
}

/** A single validation check function. */
export interface Check<T = unknown> {
  readonly name: string
  readonly run: (value: T) => CheckResult | Promise<CheckResult>
}

/** Configuration for building a Schema. */
export interface SchemaConfig {
  readonly name: string
  readonly checks: Check[]
  readonly failFast?: boolean
}

/** A named collection of validation checks. */
export class Schema {
  readonly name: string
  readonly checks: Check[]
  readonly failFast: boolean

  constructor(config: SchemaConfig) {
    this.name = config.name
    this.checks = config.checks
    this.failFast = config.failFast ?? false
  }

  /** Create a new Schema that extends this one with additional checks. */
  extend(extraChecks: Check[], failFast?: boolean): Schema {
    return new Schema({
      name: this.name,
      checks: [...this.checks, ...extraChecks],
      failFast: failFast ?? this.failFast,
    })
  }
}

/** Final validation outcome. */
export interface ValidationResult {
  readonly passed: boolean
  readonly schemaName: string
  readonly rawValue: unknown
  readonly results: CheckResult[]
  readonly violations: CheckResult[]
  readonly attempt: number
}

/** Configuration for validated() wrapper. */
export interface ValidatorOptions {
  schemas?: Record<string, Schema>
  autoDetect?: boolean
  maxAttempts?: number
  onValidationFailure?: (failure: ValidationFailureEvent) => void | Promise<void>
  escape?: 'return_raw' | 'default' | 'fallback_model'
  defaultValues?: Record<string, unknown>
  onEscape?: (event: EscapeEvent) => void | Promise<void>
  logger?: LoggerFn
  failFast?: boolean
  stripProse?: boolean
}

export interface ValidationFailureEvent {
  readonly violations: string[]
  readonly rawResponse: string
  readonly schema: string
  readonly model?: string
  readonly attempt: number
  readonly toolCalls?: unknown[] | null
  retry(): Promise<unknown>
}

export interface EscapeEvent {
  readonly reason: string
  readonly rawResponse?: string
  readonly schema: string
  readonly attempt: number
  readonly strategy: string
}

export type LoggerFn = (
  event: {
    schema: string
    attempt: number
    passed: boolean
    violations: CheckResult[]
  }
) => void

/** Result of the auto-fix pipeline. */
export interface AutoFixResult {
  readonly fixed: string | null
  readonly fixes: string[]
}
