import { describe, it, expect } from 'bun:test'
import { autoFixJson } from './auto-fix'

describe('autoFixJson', () => {
  it('returns null for empty string', () => {
    const result = autoFixJson('')
    expect(result.fixed).toBeNull()
    expect(result.fixes).toEqual([])
  })

  it('passes through valid JSON unchanged', () => {
    const result = autoFixJson('{"a": 1, "b": "hello"}')
    expect(result.fixed).toBe('{"a": 1, "b": "hello"}')
    expect(result.fixes).toEqual([])
  })

  it('strips <think> tags (DeepSeek)', () => {
    const result = autoFixJson('<think>I need to return JSON...</think>{"city": "NYC"}')
    expect(result.fixed).toBe('{"city": "NYC"}')
    expect(result.fixes).toContain('stripped_think_tags')
  })

  it('handles unclosed <think> tag (truncated)', () => {
    const result = autoFixJson('<think>I need to think about{"city": "NYC"}')
    expect(result.fixed).toBe('{"city": "NYC"}')
    expect(result.fixes).toContain('stripped_think_tags')
  })

  it('strips markdown fences', () => {
    const result = autoFixJson('```json\n{"a": 1}\n```')
    expect(result.fixed).toBe('{"a": 1}')
    expect(result.fixes).toContain('stripped_markdown_fences')
  })

  it('strips markdown fences without json tag', () => {
    const result = autoFixJson('```\n{"a": 1}\n```')
    expect(result.fixed).toBe('{"a": 1}')
    expect(result.fixes).toContain('stripped_markdown_fences')
  })

  it('extracts JSON from prose wrapping', () => {
    const result = autoFixJson('Here is your data: {"a": 1}')
    expect(result.fixed).toBe('{"a": 1}')
    expect(result.fixes).toContain('stripped_leading_prose')
  })

  it('strips trailing text after JSON', () => {
    const result = autoFixJson('{"a": 1} // some comment')
    expect(result.fixed).toBe('{"a": 1}')
    expect(result.fixes).toContain('stripped_trailing_text')
  })

  it('fixes trailing commas', () => {
    const result = autoFixJson('{"a": 1,}')
    expect(result.fixed).toBe('{"a": 1}')
    expect(result.fixes).toContain('removed_trailing_commas')
  })

  it('converts single quotes to double quotes', () => {
    const result = autoFixJson("{'a': 'b'}")
    expect(result.fixed).toBe('{"a": "b"}')
    expect(result.fixes).toContain('single_to_double_quotes')
  })

  it('quotes unquoted keys', () => {
    const result = autoFixJson('{a: "b"}')
    expect(result.fixed).toBe('{ "a": "b"}')
    expect(result.fixes).toContain('quoted_keys')
  })

  it('fixes missing closing braces (via combined fixes)', () => {
    const result = autoFixJson('{"a": "b"')
    expect(result.fixed).toBe('{"a": "b"}')
    expect(result.fixes).toContain('combined_fixes')
  })

  it('fixes nested missing closing braces', () => {
    const result = autoFixJson('{"a": {"b": 1}')
    expect(result.fixed).toBe('{"a": {"b": 1}}')
  })

  it('returns null for truly unfixable content', () => {
    const result = autoFixJson('this is not even close to json')
    expect(result.fixed).toBeNull()
  })

  it('handles combined issues: think tags + unquoted keys', () => {
    const result = autoFixJson('<think>thinking</think>{city: "NYC", temp: 72}')
    expect(result.fixed).not.toBeNull()
    if (result.fixed) {
      const parsed = JSON.parse(result.fixed)
      expect(parsed.city).toBe('NYC')
      expect(parsed.temp).toBe(72)
    }
  })
})
