import { describe, it, expect } from 'bun:test'
import { extractText, extractRawFromError } from './extractor'

describe('extractText', () => {
  it('extracts text from generateText result', () => {
    expect(extractText({ text: 'hello world' })).toBe('hello world')
  })

  it('stringifies object from generateObject result', () => {
    const result = extractText({ object: { name: 'Alice', age: 30 } })
    expect(result).toBe('{"name":"Alice","age":30}')
  })

  it('returns null for empty result', () => {
    expect(extractText({})).toBeNull()
    expect(extractText(null)).toBeNull()
    expect(extractText('string')).toBeNull()
  })
})

describe('extractRawFromError', () => {
  it('extracts from TypeValidationError.value', () => {
    expect(extractRawFromError({ value: '{"name": "Alice"}' })).toBe('{"name": "Alice"}')
  })

  it('extracts from error.response.text', () => {
    expect(extractRawFromError({ response: { text: 'raw text' } })).toBe('raw text')
  })

  it('extracts from error.message as fallback', () => {
    expect(extractRawFromError({ message: 'something went wrong' })).toBe('something went wrong')
  })

  it('returns null for non-object errors', () => {
    expect(extractRawFromError(null)).toBeNull()
    expect(extractRawFromError(undefined)).toBeNull()
    expect(extractRawFromError('string')).toBeNull()
  })
})
