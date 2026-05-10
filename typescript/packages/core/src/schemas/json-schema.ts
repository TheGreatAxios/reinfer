import { type Check } from '../types'

/**
 * Check: value is valid JSON.
 */
export function validJson(): Check<string> {
  return {
    name: 'valid_json',
    run: async (value: string) => {
      try {
        JSON.parse(value)
        return { checkName: 'valid_json', passed: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid JSON'
        return { checkName: 'valid_json', passed: false, message }
      }
    },
  }
}

/**
 * Check: parsed JSON is an object (not array, string, number).
 */
export function isObject(): Check<unknown> {
  return {
    name: 'is_object',
    run: async (value: unknown) => {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return { checkName: 'is_object', passed: true }
      }
      return {
        checkName: 'is_object',
        passed: false,
        message: 'Expected a JSON object, got ' + typeof value,
      }
    },
  }
}

/**
 * Check: required fields exist in the parsed object.
 */
export function requiredFields(fields: string[]): Check<Record<string, unknown>> {
  return {
    name: `required_fields[${fields.join(',')}]`,
    run: async (value: Record<string, unknown>) => {
      const missing = fields.filter(f => !(f in value) || value[f] === undefined || value[f] === null)
      if (missing.length === 0) {
        return { checkName: `required_fields`, passed: true }
      }
      return {
        checkName: `required_fields`,
        passed: false,
        message: `Missing required fields: ${missing.join(', ')}`,
      }
    },
  }
}

/**
 * Check: field types match expected schema.
 * Simple type checking: 'string', 'number', 'boolean', 'object', 'array'.
 */
export function fieldTypes(
  fieldTypes: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>,
): Check<Record<string, unknown>> {
  return {
    name: 'field_types',
    run: async (value: Record<string, unknown>) => {
      for (const [field, expectedType] of Object.entries(fieldTypes)) {
        const actual = value[field]
        if (actual === undefined || actual === null) continue // skip missing (required_fields handles this)

        const actualType = Array.isArray(actual) ? 'array' : typeof actual
        if (actualType !== expectedType) {
          return {
            checkName: 'field_types',
            passed: false,
            message: `Field '${field}' should be type '${expectedType}', got '${actualType}'`,
          }
        }
      }
      return { checkName: 'field_types', passed: true }
    },
  }
}

/**
 * Check: enum values match allowed set.
 */
export function enumValues(
  field: string,
  allowed: string[],
): Check<Record<string, unknown>> {
  return {
    name: `enum_values[${field}]`,
    run: async (value: Record<string, unknown>) => {
      const actual = value[field]
      if (actual === undefined || actual === null) {
        return { checkName: `enum_values[${field}]`, passed: true } // skip missing
      }
      if (!allowed.includes(String(actual))) {
        return {
          checkName: `enum_values[${field}]`,
          passed: false,
          message: `Field '${field}' value '${actual}' is not allowed. Allowed: ${allowed.join(', ')}`,
        }
      }
      return { checkName: `enum_values[${field}]`, passed: true }
    },
  }
}
