import { describe, it, expect } from 'bun:test'
import { classifyError, isValidationError } from './errors'

describe('classifyError', () => {
  it('classifies validation errors as retry', () => {
    expect(classifyError({ name: 'TypeValidationError', message: 'validation failed' })).toBe('retry')
    expect(classifyError({ name: 'ZodError', message: 'invalid' })).toBe('retry')
    expect(classifyError({ name: 'OutputValidationError', message: 'nope' })).toBe('retry')
  })

  it('classifies rate limits as retry', () => {
    expect(classifyError({ name: 'APIError', status: 429 })).toBe('retry')
    expect(classifyError({ name: 'APIError', status: 529 })).toBe('retry')
    expect(classifyError({ name: 'APIError', status: 503 })).toBe('retry')
  })

  it('classifies rate limit messages as retry', () => {
    expect(classifyError({ name: 'Error', message: 'rate limit exceeded' })).toBe('retry')
    expect(classifyError({ name: 'Error', message: 'Too many requests' })).toBe('retry')
    expect(classifyError({ name: 'Error', message: 'overloaded' })).toBe('retry')
  })

  it('classifies auth errors as escape', () => {
    expect(classifyError({ name: 'APIError', status: 401 })).toBe('escape')
    expect(classifyError({ name: 'APIError', status: 403 })).toBe('escape')
  })

  it('classifies content filter as escape', () => {
    expect(classifyError({ name: 'Error', message: 'content filter triggered' })).toBe('escape')
    expect(classifyError({ name: 'Error', message: 'safety violation' })).toBe('escape')
    expect(classifyError({ name: 'Error', message: 'refusal' })).toBe('escape')
  })

  it('classifies unknown errors as retry (optimistic)', () => {
    expect(classifyError({ name: 'UnknownError', message: 'unexpected' })).toBe('retry')
  })

  it('handles null/undefined', () => {
    expect(classifyError(null)).toBe('throw')
    expect(classifyError(undefined)).toBe('throw')
  })
})

describe('isValidationError', () => {
  it('detects TypeValidationError', () => {
    expect(isValidationError({ name: 'TypeValidationError' })).toBe(true)
  })

  it('detects ZodError', () => {
    expect(isValidationError({ name: 'ZodError' })).toBe(true)
  })

  it('detects OutputValidationError', () => {
    expect(isValidationError({ name: 'OutputValidationError' })).toBe(true)
  })

  it('returns false for other errors', () => {
    expect(isValidationError({ name: 'APIError' })).toBe(false)
    expect(isValidationError(null)).toBe(false)
    expect(isValidationError('string error')).toBe(false)
  })
})
