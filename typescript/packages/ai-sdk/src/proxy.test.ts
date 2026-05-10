import { describe, it, expect } from 'bun:test'
import { MockLanguageModelV3 } from 'ai/test'
import { z } from 'zod'

import { Schema } from 'reinfer'
import { validated } from './proxy'

const defaultUsage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
  totalTokens: 30,
}

/**
 * LanguageModelV3ResponseMetadata:
 *   id, timestamp, modelId
 */
const defaultResponse = {
  id: 'mock-resp-id',
  timestamp: new Date(),
  modelId: 'mock-model',
}

/**
 * Create a mock model that returns a single text result.
 */
function mockModel(text: string, finishReason = 'stop') {
  return new MockLanguageModelV3({
    doGenerate: {
      content: [{ type: 'text' as const, text }],
      finishReason: {
        unified: finishReason as 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other',
        raw: finishReason,
      },
      usage: defaultUsage,
      response: defaultResponse,
      warnings: [],
    },
  })
}

/**
 * Create a mock model that returns sequential results (one per doGenerate call).
 *
 * Note: We use a function instead of an array because MockLanguageModelV3's array
 * handling has an off-by-one: it reads results after incrementing the call counter,
 * so array[1] is returned on first call instead of array[0].
 */
function sequentialModel(results: Array<{ text: string; finishReason?: string }>) {
  let callCount = 0
  return new MockLanguageModelV3({
    doGenerate: () => {
      const r = results[callCount] ?? results[results.length - 1]
      callCount++
      return {
        content: [{ type: 'text' as const, text: r.text }],
        finishReason: {
          unified: (r.finishReason ?? 'stop') as 'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other',
          raw: r.finishReason ?? 'stop',
        },
        usage: defaultUsage,
        response: defaultResponse,
        warnings: [],
      }
    },
  })
}

// ──────────────────────────────────────────────
// Passthrough — no schema detected, zero overhead
// ──────────────────────────────────────────────

describe('passthrough', () => {
  it('returns raw result when validation is disabled', async () => {
    const model = mockModel('plain text')
    const { generateText } = validated({ autoDetect: false })

    const result = await generateText({
      model,
      prompt: 'Say something',
    })

    expect(result.text).toBe('plain text')
  })
})

// ──────────────────────────────────────────────
// generateObject + Zod schema
// ──────────────────────────────────────────────

describe('generateObject + Zod schema', () => {
  const personSchema = z.object({
    name: z.string(),
    age: z.number(),
  })

  it('passes on first try with valid output', async () => {
    const model = mockModel('{"name":"Alice","age":30}')
    const { generateObject } = validated({ maxAttempts: 2 })

    const result = await generateObject({
      model,
      schema: personSchema,
      prompt: 'Generate a person',
    })

    expect(result.object).toBeDefined()
    expect(result.object.name).toBe('Alice')
    expect(result.object.age).toBe(30)
  })

  it('retries when Zod validation fails (wrong types)', async () => {
    const model = sequentialModel([
      { text: '{"name":"Alice","age":"thirty"}' },
      { text: '{"name":"Alice","age":30}' },
    ])
    const { generateObject } = validated({ maxAttempts: 2 })

    const result = await generateObject({
      model,
      schema: personSchema,
      prompt: 'Generate a person',
    })

    expect(result.object).toBeDefined()
    expect(result.object.age).toBe(30)
  })

  it('retries when JSON is malformed', async () => {
    const model = sequentialModel([
      { text: '{"name":"Alice",}' },
      { text: '{"name":"Alice","age":30}' },
    ])
    const { generateObject } = validated({ maxAttempts: 2 })

    const result = await generateObject({
      model,
      schema: personSchema,
      prompt: 'Generate a person',
    })

    expect(result.object).toBeDefined()
    expect(result.object.name).toBe('Alice')
    expect(result.object.age).toBe(30)
  })

  it('auto-fixes trailing commas without retry', async () => {
    const model = mockModel('{"name":"Alice","age":30,}')
    const { generateObject } = validated({ maxAttempts: 2 })

    const result = await generateObject({
      model,
      schema: personSchema,
      prompt: 'Generate a person',
    })

    expect(result.object).toBeDefined()
    expect(result.object.name).toBe('Alice')
    expect(result.object.age).toBe(30)
  })

  it('throws after maxAttempts with persistent bad output', async () => {
    const model = sequentialModel([
      { text: '{"name":"Alice","age":"bad"}' },
      { text: '{"name":"Bob","age":"also-bad"}' },
    ])
    const { generateObject } = validated({ maxAttempts: 2 })

    await expect(
      generateObject({
        model,
        schema: personSchema,
        prompt: 'Generate a person',
      }),
    ).rejects.toThrow()
  })
})

// ──────────────────────────────────────────────
// generateText + custom validation (non-Zod)
// ──────────────────────────────────────────────

describe('generateText + custom validation', () => {
  const jsonSchema = new Schema({ name: 'json_response', checks: [] })

  it('retries when response is truncated', async () => {
    const model = sequentialModel([
      { text: '{"name":"Alice"', finishReason: 'length' },
      { text: '{"name":"Alice","age":30}', finishReason: 'stop' },
    ])
    const { generateText } = validated({
      schemas: { default: jsonSchema },
      maxAttempts: 2,
    })

    const result = await generateText({
      model,
      prompt: 'Return JSON',
    })

    expect(result.text).toBe('{"name":"Alice","age":30}')
  })
})
