import { describe, it, expect } from 'bun:test'
import { hasSchema, detectSchema, mapFinishReason, getFinishReason } from './signals'

describe('hasSchema', () => {
  it('detects schema in generateObject params', () => {
    expect(hasSchema({ schema: { type: 'object' } })).toBe(true)
  })

  it('detects schema in generateText output params', () => {
    expect(hasSchema({ output: { schema: { type: 'object' } } })).toBe(true)
  })

  it('returns false when no schema present', () => {
    expect(hasSchema({ prompt: 'hello' })).toBe(false)
    expect(hasSchema({})).toBe(false)
  })

  it('detects responseFormat', () => {
    expect(hasSchema({ responseFormat: { type: 'json' } })).toBe(true)
  })
})

describe('detectSchema', () => {
  it('extracts schema from generateObject params', () => {
    const schema = { type: 'object', properties: {} }
    expect(detectSchema({ schema })).toBe(schema)
  })

  it('extracts schema from output params', () => {
    const schema = { type: 'object' }
    expect(detectSchema({ output: { schema } })).toBe(schema)
  })

  it('returns undefined when no schema', () => {
    expect(detectSchema({ prompt: 'hello' })).toBeUndefined()
  })
})

describe('mapFinishReason', () => {
  it('maps standard reasons', () => {
    expect(mapFinishReason('stop')).toBe('stop')
    expect(mapFinishReason('length')).toBe('length')
    expect(mapFinishReason('content_filter')).toBe('content_filter')
  })

  it('normalizes dashes to underscores', () => {
    expect(mapFinishReason('content-filter')).toBe('content_filter')
    expect(mapFinishReason('tool-calls')).toBe('tool_calls')
  })

  it('maps unknown reasons to other', () => {
    expect(mapFinishReason('unknown_reason')).toBe('other')
    expect(mapFinishReason(undefined)).toBe('other')
  })
})

describe('getFinishReason', () => {
  it('reads from result object', () => {
    expect(getFinishReason({ finishReason: 'stop' })).toBe('stop')
    expect(getFinishReason({ finishReason: 'length' })).toBe('length')
    expect(getFinishReason({})).toBe('other')
    expect(getFinishReason(null)).toBe('other')
  })
})
