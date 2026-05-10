import { describe, it, expect } from 'bun:test'
import { validate, extractString, formatViolations } from './validator'
import { Schema } from './types'

describe('validate', () => {
  it('passes when all checks pass', async () => {
    const schema = new Schema({
      name: 'test',
      checks: [
        { name: 'check1', run: async () => ({ checkName: 'check1', passed: true }) },
        { name: 'check2', run: async () => ({ checkName: 'check2', passed: true }) },
      ],
    })
    const result = await validate('hello', schema)
    expect(result.passed).toBe(true)
    expect(result.violations).toHaveLength(0)
    expect(result.attempt).toBe(1)
  })

  it('fails when a check fails', async () => {
    const schema = new Schema({
      name: 'test',
      checks: [
        { name: 'pass', run: async () => ({ checkName: 'pass', passed: true }) },
        { name: 'fail', run: async () => ({ checkName: 'fail', passed: false, message: 'nope' }) },
      ],
    })
    const result = await validate('hello', schema)
    expect(result.passed).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].message).toBe('nope')
  })

  it('stops at first failure when failFast is true', async () => {
    let secondRan = false
    const schema = new Schema({
      name: 'test',
      checks: [
        { name: 'fail1', run: async () => ({ checkName: 'fail1', passed: false, message: 'first' }) },
        {
          name: 'fail2',
          run: async () => {
            secondRan = true
            return { checkName: 'fail2', passed: false, message: 'second' }
          },
        },
      ],
      failFast: true,
    })
    const result = await validate('hello', schema)
    expect(result.passed).toBe(false)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0].message).toBe('first')
    expect(secondRan).toBe(false)
  })

  it('runs all checks when failFast is false', async () => {
    let secondRan = false
    const schema = new Schema({
      name: 'test',
      checks: [
        { name: 'fail1', run: async () => ({ checkName: 'fail1', passed: false, message: 'first' }) },
        {
          name: 'fail2',
          run: async () => {
            secondRan = true
            return { checkName: 'fail2', passed: false, message: 'second' }
          },
        },
      ],
      failFast: false,
    })
    await validate('hello', schema)
    expect(secondRan).toBe(true)
  })

  it('tracks attempt number', async () => {
    const schema = new Schema({
      name: 'test',
      checks: [{ name: 'pass', run: async () => ({ checkName: 'pass', passed: true }) }],
    })
    const result = await validate('hello', schema, 3)
    expect(result.attempt).toBe(3)
  })
})

describe('extractString', () => {
  it('returns null for non-string input', () => {
    expect(extractString(42)).toBeNull()
    expect(extractString(null)).toBeNull()
    expect(extractString({})).toBeNull()
  })

  it('returns trimmed string when no prose wrapping', () => {
    expect(extractString('  hello  ')).toBe('hello')
  })

  it('extracts JSON from prose', () => {
    const result = extractString('Here is your data: {"name": "test"}')
    expect(result).toBe('{"name": "test"}')
  })

  it('extracts JSON array from prose', () => {
    const result = extractString('Result: [1, 2, 3] Thanks!')
    expect(result).toBe('[1, 2, 3]')
  })

  it('returns full string when no braces found', () => {
    expect(extractString('just text')).toBe('just text')
  })
})

describe('formatViolations', () => {
  it('formats violations with bullet points', () => {
    const result = formatViolations([
      { checkName: 'valid_json', passed: false, message: 'Invalid JSON' },
      { checkName: 'required_fields', passed: false, message: 'Missing: name' },
    ])
    expect(result).toContain('valid_json')
    expect(result).toContain('Invalid JSON')
    expect(result).toContain('required_fields')
    expect(result).toContain('Missing: name')
    expect(result.startsWith('•')).toBe(true)
  })
})
